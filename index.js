import parquet from "@dsnp/parquetjs";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import dns from "dns";

import getUrl from "./getUrl.js";
import Wappalyzer from "./wappalyzer.js";

puppeteer.use(StealthPlugin());

const categories = JSON.parse(
  fs.readFileSync("./webappanalyzer/src/categories.json", "utf8"),
);
const technologies = JSON.parse(fs.readFileSync("./result.json", "utf8"));

Wappalyzer.setTechnologies(technologies);
Wappalyzer.setCategories(categories);

(async () => {
  let reader = await parquet.ParquetReader.openFile(
    "part-00000-66e0628d-2c7f-425a-8f5b-738bcd6bf198-c000.snappy.parquet",
  );
  let cursor = reader.getCursor();

  const browser = await puppeteer.launch({
    ignoreHTTPSErrors: true,
    args: ["--disable-http2", "--ignore-certificate-errors"],
  });

  const page = await browser.newPage();
  let record = null;
  let n = 0;
  const results = [];

  while ((record = await cursor.next())) {
    try {
      const url = await getUrl(record.root_domain);

      const dnsRecords = {};
      const [mx, txt, ns, soa, cname] = await Promise.allSettled([
        dns.promises.resolveMx(record.root_domain),
        dns.promises.resolveTxt(record.root_domain),
        dns.promises.resolveNs(record.root_domain),
        dns.promises.resolveSoa(record.root_domain),
        dns.promises.resolveCname(record.root_domain),
      ]);

      if (mx.status === "fulfilled")
        dnsRecords["MX"] = mx.value.map((r) => r.exchange);
      if (txt.status === "fulfilled") dnsRecords["TXT"] = txt.value.flat();
      if (ns.status === "fulfilled") dnsRecords["NS"] = ns.value;
      if (soa.status === "fulfilled") dnsRecords["SOA"] = [soa.value.nsname];
      if (cname.status === "fulfilled") dnsRecords["CNAME"] = cname.value;

      let headers = {};
      const responseHandler = (response) => {
        if (response.url() === url || response.url() === url + "/") {
          headers = response.headers();
        }
      };
      page.on("response", responseHandler);

      const xhrUrls = [];
      const xhrHandler = (request) => {
        const resourceType = request.resourceType();
        if (resourceType === "xhr" || resourceType === "fetch") {
          xhrUrls.push(request.url());
        }
      };
      page.on("request", xhrHandler);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

      page.off("request", xhrHandler);
      page.off("response", responseHandler);

      const xhr = xhrUrls.join("\n");
      const html = await page.content();

      const scriptSrc = await page.evaluate(() =>
        Array.from(document.querySelectorAll("script[src]")).map((s) => s.src),
      );

      const scripts = await page.evaluate(() =>
        Array.from(document.querySelectorAll("script:not([src])")).map(
          (s) => s.innerHTML,
        ),
      );

      const text = await page.evaluate(() => document.body?.innerText || "");

      const dom = await page.evaluate(() => {
        const result = {};
        try {
          const allElements = document.querySelectorAll("*");
          allElements.forEach((el) => {
            const id = el.id ? `#${el.id}` : null;
            const classes = Array.from(el.classList).map((c) => `.${c}`);
            if (id) result[id] = [""];
            classes.forEach((c) => (result[c] = [""]));
          });
        } catch {}
        return result;
      });

      const meta = await page.evaluate(() =>
        Array.from(document.querySelectorAll("meta")).reduce((acc, m) => {
          const name = m.getAttribute("name") || m.getAttribute("property");
          if (name) {
            acc[name.toLowerCase()] = acc[name.toLowerCase()] || [];
            acc[name.toLowerCase()].push(m.getAttribute("content") || "");
          }
          return acc;
        }, {}),
      );

      const js = await page.evaluate((techs) => {
        const vars = {};
        for (const tech of Object.values(techs)) {
          if (!tech.js) continue;
          for (const path of Object.keys(tech.js)) {
            try {
              const parts = path.split(".");
              let obj = window;
              for (const part of parts) {
                if (obj === undefined || obj === null) {
                  obj = undefined;
                  break;
                }
                obj = obj[part];
              }
              if (obj !== undefined) {
                vars[path] = [String(obj)];
              }
            } catch {}
          }
        }
        return vars;
      }, technologies);

      const probe = await page.evaluate((techs) => {
        const vars = {};
        for (const tech of Object.values(techs)) {
          if (!tech.probe) continue;
          for (const path of Object.keys(tech.probe)) {
            try {
              const parts = path.split(".");
              let obj = window;
              for (const part of parts) {
                if (obj === undefined || obj === null) {
                  obj = undefined;
                  break;
                }
                obj = obj[part];
              }
              if (obj !== undefined) {
                vars[path] = [String(obj)];
              }
            } catch {}
          }
        }
        return vars;
      }, technologies);

      const cookiesRaw = await page.cookies();
      const cookies = cookiesRaw.reduce((acc, c) => {
        acc[c.name] = acc[c.name] || [];
        acc[c.name].push(c.value);
        return acc;
      }, {});

      const headersFormatted = Object.keys(headers).reduce((acc, key) => {
        acc[key] = [headers[key]];
        return acc;
      }, {});

      let detections = [];
      try {
        detections = Wappalyzer.analyze({
          url,
          html,
          headers: headersFormatted,
          scriptSrc,
          scripts,
          text,
          cookies,
          meta,
          js,
          probe,
          dom,
          xhr,
          dns: dnsRecords,
        });
      } catch (err) {
        console.log(`Analyze error: ${err.message}`);
      }

      const evidence = {};
      detections.forEach(d => {
        if (!evidence[d.technology.name]) {
          let displayValue;
          if (d.pattern.type === 'js') {
            const tech = technologies[d.technology.name];
            const jsKey = tech?.js ? Object.keys(tech.js)[0] : null;
            displayValue = jsKey ? `window.${jsKey} exists` : null;
          } else if (d.pattern.type === 'headers') {
            displayValue = String(d.pattern.value).slice(0, 200);
          } else if (d.pattern.type === 'cookies') {
            displayValue = String(d.pattern.value).slice(0, 200);
          } else if (typeof d.pattern.value === 'object') {
            displayValue = JSON.stringify(d.pattern.value).slice(0, 200);
          } else {
            displayValue = String(d.pattern.value).slice(0, 200);
          }
          evidence[d.technology.name] = {
            type: d.pattern.type,
            value: displayValue,
          };
        }
      });

      const detected = Wappalyzer.resolve(detections)
        .filter((t) => t.confidence >= 75)
        .map((t) => ({
          name: t.name,
          evidence: evidence[t.name] || { type: "implied", value: null },
        }));

      results.push({ domain: record.root_domain, technologies: detected });
      console.log(
        `[${++n}] ${record.root_domain} → ${detected.map((t) => t.name).join(", ") || "none"}`,
      );

      if (n % 10 === 0) {
        fs.writeFileSync("./output.json", JSON.stringify(results, null, 2));
      }
    } catch (err) {
      console.log(`[${++n}] ${record.root_domain} → ERROR: ${err.message}`);
      results.push({ domain: record.root_domain, technologies: [] });
    }
  }

  fs.writeFileSync("./output.json", JSON.stringify(results, null, 2));
  const allTechs = new Set();
  results.forEach((r) => r.technologies.forEach((t) => allTechs.add(t.name)));
  console.log(`Total diff technologies: ${allTechs.size}`);
  console.log("Done!");

  await browser.close();
  await reader.close();
})();

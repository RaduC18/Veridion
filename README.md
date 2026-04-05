# README

This README contains the following topics:
- [Debate Topics](#debate-topics)
- [Solution Explanation](#solution-explanation)

---

## Debate Topics

### 1. What were the main issues with your current implementation and how would you tackle them?

One of the problems is that some sites block my access even though I use the StealthPlugin function from puppeteer-extra-plugin-stealth. I consider that a solution to this cause is the use of residential proxies because these are harder to detect.

Another problem that may be is the detection and management of redirects, some sites gave the error `Execution context was destroyed` because they made a redirect during data collection. I could intercept the redirects and restart the data collection from the new page instead of considering the site as an error.

The duration of scanning all domains is very large, I would get a laptop with a higher processing power and I would scan multiple domains in parallel at the same time.

---

### 2. How would you scale this solution for millions of domains crawled in a timely manner (1-2 months)?

At the moment the application processes one domain at a time and that already leads to a quite large loss of time. To scale the solution to millions of domains in 1-2 months I would process more domains in parallel and at the same time I would split the list of domains into multiple parts and I would process each part on a different machine to increase the processing power, and the results I would store in a database, not in a JSON, to be easier to manage further.

---

### 3. How would you discover new technologies in the future?

Personally to discover other technologies one of the attempts would be to periodically follow npmjs and if a library would appear that has a relevant number of downloads I would add a fingerprint for it.

Another idea would be that when a script is not found in the JSON file or in the database where the fingerprints of the technologies are and is found repeatedly on multiple sites to be marked as review for a possibility of the appearance of a new technology.

Another approach could be the use of an LLM (e.g.: Claude) in which I would tell it to analyze the HTML of a site and tell me what technologies it identifies and how it deduced. If a technology is not found in my JSON file, I note it and if this technology repeats itself multiple times on different sites then I will add it to the JSON file.

---

## Solution Explanation

### English Version

First, I searched for how I could do scraping in NodeJs and found two ways to do it: HTTP requests and the Puppeteer library. I chose Puppeteer because HTTP requests can only receive static HTML, while Puppeteer can also receive JavaScript code. I still used HTTP requests in the getUrl function to determine the correct URL for all sites used later in the .goto function from Puppeteer. I first tested the Puppeteer library for a simpler task, that of extracting all the code of the site, and noticed that some sites blocked access to them. I used a proxy, but also setting an agent through the .setUserAgent() command from Puppeteer, but I did not get very good results because the sites still detected me as a bot. The best results I got using the StealthPlugin function from puppeteer-extra-plugin-stealth. I also used when I launched the browser the following commands:
- `ignoreHTTPSErrors: true`: tells Puppeteer to ignore HTTPS errors at the library level, for example expired or self-signed certificates.
- `--disable-http2`: disables the HTTP/2 protocol and forces the use of HTTP/1.1. Some sites have compatibility issues with HTTP/2 in Puppeteer and may give errors or not load correctly.
- `--ignore-certificate-errors`: tells Chrome to ignore SSL certificate errors at the browser level. Complementary to ignoreHTTPSErrors: true but at a different level, one is at the Puppeteer library level and the other is at the Chrome browser level.

For the part of recognizing technologies from each site I tried to find a library dedicated to this task, but I did not find one with enough downloads to seem like a good library. The most popular library dedicated to technology detection is Wappalyze, but it is no longer public. I finally found a repository on GitHub where a file was found in which the Wappalyzer engine from the library that is no longer available was implemented. The repository also contained, moreover, several JSON files organized alphabetically that each contained the fingerprints of several technologies. I combined them all using a code I wrote in the jsonReader.js file that combines all files into a single one I named result.json. Each technology in JSON contains:
- `cats`: the categories the technology belongs to (e.g.: CMS, Analytics, Ecommerce)
- `html`: regex patterns applied to the page HTML
- `scriptSrc`: regex patterns applied to external script URLs
- `scripts`: regex patterns applied to inline script content
- `js`: paths of global variables from window
- `probe`: similar to js, for a different set of variables specific to some technologies
- `dom`: CSS selectors for elements in the page
- `meta`: patterns for meta tags
- `headers`: patterns for HTTP headers
- `cookies`: patterns for cookies
- `xhr`: patterns for XHR and fetch requests
- `dns`: patterns for DNS records
- `url`: patterns for URL structure
- `text`: patterns for visible text of the page
- `implies`: what other technologies the detection of this one implies
- `excludes`: what technologies the detection of this one excludes
- `icon`, `website`, `description`: information about technology

The categories.json file contains the technology categories with an id, name and priority. Categories are used by Wappalyzer in the .resolve() function to sort detected technologies by priority. After reading the JSON files I sent them to Wappalyzer through two functions:
- `Wappalyzer.setTechnologies(technologies)`: processes all fingerprints and compiles regex patterns for fast detection
- `Wappalyzer.setCategories(categories)`: loads categories for sorting results

For each domain from the parquet list I opened the site with Puppeteer and collected several types of data:
- `html`: the complete HTML of the page obtained through page.content().
- `scriptSrc`: URLs of external scripts extracted from `<script src="...">` tags.
- `scripts`: content of inline scripts extracted from `<script>` tags without the src attribute.
- `meta`: meta tags extracted from the page — these contain important information about the technologies used, for example `<meta name="generator" content="WordPress">`.
- `js` and `probe`: checks if specific JavaScript variables exist in window. For example if window.Squarespace exists it means the site uses Squarespace.
- `dom`: all classes and ids of HTML elements in the page, used to detect technologies that leave specific CSS classes in the page.
- `text`: the visible text of the page obtained through document.body.innerText. Some technologies are detected from the visible text of the page, for example "Powered by Shopify".
- `cookies`: cookies collected through page.cookies() after the page loads.
- `headers`: HTTP headers intercepted from the response of the main page through page.on('response'), contain information about the web server or CDN used.
- `xhr`: XHR and fetch requests intercepted in real time through page.on('request'), these show what external services the site calls in the background.
- `dns`: DNS records queried in parallel using Promise.allSettled() for MX, TXT, NS, SOA and CNAME, these can indicate email, CDN or hosting services used by the domain. I used the dns library.
- `url`: the page URL sent to Wappalyzer to detect technologies from the URL structure.

All this data was sent to Wappalyzer.analyze() which compared it with the fingerprints and returned the list of detections. Then Wappalyzer.resolve() processed the detections automatically applying implies and excludes and filtering by a minimum confidence threshold of 75% to reduce false positives. For each detected technology I also saved the detection evidence (output.json), where and how it was detected:
- `type`: the source of the detection
- `value`: the exact value that triggered the detection.

Technologies detected through `implies` have `type: implied` and `value: null` because they have no direct evidence but were automatically added by Wappalyzer.

### Results

From the 200 analyzed domains I detected **289 different technologies** compared to 477 identified as reference. The difference can be explained by:
- **Inaccessible sites**: `ERR_CONNECTION_REFUSED` (server offline), `ERR_CONNECTION_TIMED_OUT` (site too slow), `ERR_NAME_NOT_RESOLVED` (domain non-existent in DNS), `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` (incompatible SSL certificate) or Navigation timeout (site that did not load in 90 seconds).
- **Navigation errors**: some sites gave the error `Execution context was destroyed` because they made a redirect during data collection, destroying the JavaScript context of the page.
- **Fingerprints**: I think there is a possibility that some fingerprints from JSON do not match those from sites.

I did not include internal pages in the site scraping because they did not add much in terms of new technologies and significantly increased processing time.

There were also a few cases of false positives (gapconstructionwi.com, broganlmt.com, pcb-cpb.com → WordPress, Wix).

---

### Versiunea în Română

Prima dată am căutat cum aș putea să fac scraping în NodeJs și am găsit două moduri prin care se poate face: request-uri HTTP și librăria Puppeteer. Am ales Puppeteer deoarece prin request-uri HTTP se poate primi doar HTML-ul static, iar cu Puppeteer se poate primi și codul JavaScript. Am folosit totuși request-uri HTTP în funcția getUrl pentru a determina URL-ul corect pentru toate site-urile folosit mai apoi în funcția .goto din Puppeteer. Am testat mai întâi librăria Puppeteer pentru un task mai simplu acela de a extrage tot codul site-ului și am observat că unele site-uri blocau accesul către ele. Am folosirea unui proxy, dar și setarea unui agent prin comanda .setUserAgent() din Puppeteer, dar nu am obținut rezultate foarte bune deoarece site-urile încă mă detectau că sunt un bot. Cele mai bune rezultate le-am obținut folosind funcția StealthPlugin din puppeteer-extra-plugin-stealth. Am mai folosit când am lansat browser-ul următoarele comenzi:
- `ignoreHTTPSErrors: true`: spune Puppeteer să ignore erorile HTTPS la nivel de librărie, de exemplu certificate expirate sau self-signed.
- `--disable-http2`: dezactivează protocolul HTTP/2 și forțează folosirea HTTP/1.1. Unele site-uri au probleme de compatibilitate cu HTTP/2 în Puppeteer și pot da erori sau nu se încarcă corect.
- `--ignore-certificate-errors`: spune Chrome să ignore erorile de certificat SSL la nivel de browser. Complementar cu ignoreHTTPSErrors: true dar la un nivel diferit, unul e la nivelul librăriei Puppeteer și celălalt e la nivelul browserului Chrome.

Pentru partea de recunoaștere a tehnologiilor din fiecare site am încercat să găsesc o librărie dedicată acestui task, însă nu am găsit niciuna cu un număr de descărcări suficiente încât să pară o librărie bună. Cea mai populară librărie dedicată detecției de tehnologii este Wappalyze, dar nu mai este publică. Am găsit până la urmă un depozit pe GitHub în care se regăsea un fișier în care era implementat motorul Wappalyzer din librăria care nu mai este disponibilă. Depozitul mai conținea, de altfel, mai multe fișiere JSON organizate alfabetic care conțineau fiecare fingerprint-urile a mai multor tehnologii. Le-am combinat pe toate folosind un cod pe care l-am scris în fișierul jsonReader.js care combină toate fișierele într-unul singur pe care l-am denumit result.json. Fiecare tehnologie din JSON conține:
- `cats`: categoriile din care face parte tehnologia (ex: CMS, Analytics, Ecommerce)
- `html`: regex-uri aplicate pe HTML-ul paginii
- `scriptSrc`: regex-uri aplicate pe URL-urile scripturilor externe
- `scripts`: regex-uri aplicate pe conținutul scripturilor inline
- `js`: căi de variabile globale din window
- `probe`: similar cu js, pentru un set diferit de variabile specifice unor tehnologii
- `dom`: selectoare CSS pentru elemente din pagină
- `meta`: pattern-uri pentru tag-urile meta
- `headers`: pattern-uri pentru HTTP headers
- `cookies`: pattern-uri pentru cookies
- `xhr`: pattern-uri pentru request-urile XHR și fetch
- `dns`: pattern-uri pentru recordurile DNS
- `url`: pattern-uri pentru structura URL-ului
- `text`: pattern-uri pentru textul vizibil al paginii
- `implies`: ce alte tehnologii implică detectarea acesteia
- `excludes`: ce tehnologii exclude detectarea acesteia
- `icon`, `website`, `description`: informații despre tehnologie

Fișierul categories.json conține categoriile de tehnologii cu un id, name și priority. Categoriile sunt folosite de Wappalyzer în funcția .resolve() pentru a sorta tehnologiile detectate după prioritate. După ce am citit fișierele JSON le-am trimis la Wappalyzer prin două funcții:
- `Wappalyzer.setTechnologies(technologies)`: procesează toate fingerprint-urile și compilează regex-urile pentru detecție rapidă
- `Wappalyzer.setCategories(categories)`: încarcă categoriile pentru sortarea rezultatelor

Pentru fiecare domeniu din lista parquet am deschis site-ul cu Puppeteer și am colectat mai multe tipuri de date:
- `html`: HTML-ul complet al paginii obținut prin page.content().
- `scriptSrc`: URL-urile scripturilor externe extrase din tag-urile `<script src="...">`.
- `scripts`: conținutul scripturilor inline extrase din tag-urile `<script>` fără atributul src.
- `meta`: tag-urile meta extrase din pagină — acestea conțin informații importante despre tehnologiile folosite, de exemplu `<meta name="generator" content="WordPress">`.
- `js` și `probe`: verifică dacă variabile JavaScript specifice există în window. De exemplu dacă window.Squarespace există înseamnă că site-ul folosește Squarespace.
- `dom`: toate clasele și id-urile elementelor HTML din pagină, folosite pentru a detecta tehnologii care lasă clase CSS specifice în pagină.
- `text`: textul vizibil al paginii obținut prin document.body.innerText. Unele tehnologii se detectează din textul vizibil al paginii, de exemplu "Powered by Shopify".
- `cookies`: cookies colectate prin page.cookies() după încărcarea paginii.
- `headers`: HTTP headers interceptate din response-ul paginii principale prin page.on('response'), conțin informații despre serverul web sau CDN-ul folosit.
- `xhr`: request-urile XHR și fetch interceptate în timp real prin page.on('request'), acestea arată ce servicii externe apelează site-ul în background.
- `dns`: recordurile DNS interogate în paralel folosind Promise.allSettled() pentru MX, TXT, NS, SOA și CNAME, acestea pot indica servicii de email, CDN sau hosting folosite de domeniu. Am folosit librăria dns.
- `url`: URL-ul paginii trimis la Wappalyzer pentru a detecta tehnologii din structura URL-ului.

Toate aceste date au fost trimise la Wappalyzer.analyze() care le-a comparat cu fingerprint-urile și a returnat lista de detecții. Apoi Wappalyzer.resolve() a procesat detecțiile aplicând automat implies și excludes și filtrând după un prag minim de confidence de 75% pentru a reduce false positive-urile. Pentru fiecare tehnologie detectată am salvat și dovada detecției (output.json), de unde și cum a fost detectată:
- `type`: sursa detecției
- `value`: valoarea exactă care a declanșat detecția.

Tehnologiile detectate prin `implies` au `type: implied` și `value: null` deoarece nu au o dovadă directă ci au fost adăugate automat de Wappalyzer.

### Rezultate

Din cele 200 de domenii analizate am detectat **289 tehnologii diferite** față de 477 identificate ca referință. Diferența se poate explica prin:
- **Site-uri inaccesibile**: `ERR_CONNECTION_REFUSED` (server offline), `ERR_CONNECTION_TIMED_OUT` (site prea lent), `ERR_NAME_NOT_RESOLVED` (domeniu inexistent în DNS), `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` (certificat SSL incompatibil) sau Navigation timeout (site care nu s-a încărcat în 90 de secunde).
- **Erori de navigare**: unele site-uri au dat eroarea `Execution context was destroyed` deoarece au făcut un redirect în timpul colectării datelor, distrugând contextul JavaScript al paginii.
- **Fingerprint-uri**: mă gândesc că există posibilitatea că unele fingerprint-uri din JSON să nu se potrivească cu cele din site-uri.

Nu am inclus în analiza site-urilor și paginile interne deoarece nu aduceau foarte multe tehnologii în plus și creștea mult timpul de procesare.

Au existat și câteva cazuri de false positives (gapconstructionwi.com, broganlmt.com, pcb-cpb.com → WordPress, Wix).

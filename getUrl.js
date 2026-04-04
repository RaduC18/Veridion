export default async function getUrl(domain) {
  try {
    await axios.head(`https://${domain}`);
    return `https://${domain}`;
  } catch {
    try {
      await axios.head(`http://${domain}`);
      return `http://${domain}`;
    } catch {
      return `https://${domain}`;
    }
  }
}
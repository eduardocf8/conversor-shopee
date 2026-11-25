// Diagnóstico temporário: lê (stdin) o JSON do projeto Pages e mostra só nomes/ids das ligações
const p = JSON.parse(require("fs").readFileSync(0, "utf8")).result;
for (const amb of ["production", "preview"]) {
  const c = p.deployment_configs[amb] || {};
  console.log(amb, "d1:", JSON.stringify(c.d1_databases || null), "config_hash:", Boolean(c.wrangler_config_hash), "vars:", Object.keys(c.env_vars || {}).join(","));
}

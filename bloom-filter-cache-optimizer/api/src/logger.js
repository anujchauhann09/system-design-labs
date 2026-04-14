// structured logger for the cache pipeline
function logLookup(id, meta) {
  const entry = {
    ts: new Date().toISOString(),
    event: "user_lookup",
    id,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

function logWrite(id, name) {
  const entry = {
    ts: new Date().toISOString(),
    event: "user_created",
    id,
    name,
  };
  console.log(JSON.stringify(entry));
}

module.exports = { logLookup, logWrite };

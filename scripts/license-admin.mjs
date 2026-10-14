const baseUrl = (
  process.env.LICENSE_ADMIN_URL ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");
const token = process.env.LICENSE_ADMIN_TOKEN;
const [command, id, ...args] = process.argv.slice(2);

if (!token) {
  console.error("Set LICENSE_ADMIN_TOKEN before running this tool.");
  process.exit(1);
}

async function request(path, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error?.code ?? `HTTP ${response.status}`);
  }
  return result;
}

try {
  if (command === "create") {
    const plan = args[0] ?? "Dev+ Mensal";
    const durationMonths = Number(args[1] ?? 1);
    const result = await request("/admin/licenses", "POST", {
      plan,
      durationMonths,
    });
    console.log("License created. Copy this key now; it is shown only once:");
    console.log(result.key);
    console.log(JSON.stringify(result.license, null, 2));
  } else if (command === "list") {
    const result = await request("/admin/licenses");
    console.log(JSON.stringify(result.licenses, null, 2));
  } else if (command === "revoke" && id) {
    const result = await request(`/admin/licenses/${id}/revoke`, "POST", {});
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "renew" && id) {
    const durationMonths = Number(args[0] ?? 1);
    const result = await request(`/admin/licenses/${id}/renew`, "POST", {
      durationMonths,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "reset-device" && id) {
    const result = await request(
      `/admin/licenses/${id}/reset-device`,
      "POST",
      {},
    );
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(
      "Usage: bun run license:admin -- create [plan] [months] | list | revoke <id> | renew <id> [months] | reset-device <id>",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`License admin request failed: ${error.message}`);
  process.exitCode = 1;
}

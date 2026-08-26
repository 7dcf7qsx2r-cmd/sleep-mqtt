const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

async function emqxJson(
  apiUrl: string,
  user: string,
  password: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: basicAuth(user, password),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, data };
}

export async function waitForEmqx(apiUrl: string, user: string, password: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  const root = apiUrl.replace(/\/$/, "");
  while (Date.now() - start < timeoutMs) {
    try {
      const plain = await fetch(`${root}/status`);
      if (plain.ok) {
        const nodes = await emqxJson(apiUrl, user, password, "GET", "/api/v5/nodes");
        if (nodes.status === 200) return;
      }
    } catch {
      /* retry */
    }
    await sleep(1500);
  }
  throw new Error(`EMQX API not ready: ${apiUrl}`);
}

export async function configureEmqxHttpAuth(input: {
  apiUrl: string;
  user: string;
  password: string;
  authUrl: string;
  aclUrl: string;
}): Promise<void> {
  const authn = {
    mechanism: "password_based",
    backend: "http",
    enable: true,
    method: "post",
    url: input.authUrl,
    headers: { "content-type": "application/json" },
    body: {
      clientid: "${clientid}",
      username: "${username}",
      password: "${password}",
    },
    ssl: { enable: false },
  };

  const putAuth = await emqxJson(
    input.apiUrl,
    input.user,
    input.password,
    "PUT",
    "/api/v5/authentication/password_based%3Ahttp",
    authn,
  );
  if (putAuth.status === 404) {
    const created = await emqxJson(
      input.apiUrl,
      input.user,
      input.password,
      "POST",
      "/api/v5/authentication",
      authn,
    );
    if (created.status >= 300) {
      throw new Error(`create HTTP auth failed ${created.status}: ${JSON.stringify(created.data)}`);
    }
  } else if (putAuth.status >= 300) {
    throw new Error(`update HTTP auth failed ${putAuth.status}: ${JSON.stringify(putAuth.data)}`);
  }

  await emqxJson(input.apiUrl, input.user, input.password, "PUT", "/api/v5/authorization/settings", {
    no_match: "deny",
    deny_action: "disconnect",
    cache: { enable: false },
  });

  const sources = await emqxJson(input.apiUrl, input.user, input.password, "GET", "/api/v5/authorization/sources");
  const list = Array.isArray(sources.data) ? sources.data as Array<{ type?: string }> : [];
  for (const source of list) {
    if (source.type && source.type !== "http") {
      await emqxJson(
        input.apiUrl,
        input.user,
        input.password,
        "DELETE",
        `/api/v5/authorization/sources/${encodeURIComponent(source.type)}`,
      );
    }
  }

  const authz = {
    type: "http",
    enable: true,
    method: "post",
    url: input.aclUrl,
    headers: { "content-type": "application/json" },
    body: {
      clientid: "${clientid}",
      username: "${username}",
      topic: "${topic}",
      action: "${action}",
    },
    ssl: { enable: false },
  };

  const putAcl = await emqxJson(
    input.apiUrl,
    input.user,
    input.password,
    "PUT",
    "/api/v5/authorization/sources/http",
    authz,
  );
  if (putAcl.status === 404) {
    const created = await emqxJson(
      input.apiUrl,
      input.user,
      input.password,
      "POST",
      "/api/v5/authorization/sources",
      authz,
    );
    if (created.status >= 300) {
      throw new Error(`create HTTP ACL failed ${created.status}: ${JSON.stringify(created.data)}`);
    }
  } else if (putAcl.status >= 300) {
    throw new Error(`update HTTP ACL failed ${putAcl.status}: ${JSON.stringify(putAcl.data)}`);
  }
}

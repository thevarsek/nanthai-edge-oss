self.addEventListener("push", (event) => {
  event.waitUntil(handlePushEvent(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});

const NOTIFICATION_ICON = "/icons/icon-192.png";
const NOTIFICATION_BADGE = "/icons/icon-192.png";

async function handlePushEvent(event) {
  const payload = parsePushPayload(event);
  if (!payload || !payload.title || !payload.body) {
    return;
  }

  if (payload.category === "CHAT_COMPLETION" && await hasFocusedAppClient()) {
    return;
  }

  const targetUrl = payload.chatId ? `/app/chat/${payload.chatId}` : "/app";
  await self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    tag: payload.chatId ? `chat-${payload.chatId}-${payload.category || "general"}` : undefined,
    data: {
      chatId: payload.chatId || null,
      category: payload.category || null,
      url: targetUrl,
    },
  });
}

async function handleNotificationClick(event) {
  const targetUrl = new URL(
    event.notification.data?.url || "/app",
    self.location.origin,
  ).href;
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const appClients = clients.filter((client) => {
    const url = new URL(client.url);
    return url.pathname === "/app" || url.pathname.startsWith("/app/");
  });
  const exactClient = appClients.find((client) => client.url === targetUrl);

  if (exactClient) {
    await exactClient.focus();
    return;
  }

  const reusableClient = appClients[0];
  if (reusableClient && "navigate" in reusableClient) {
    await reusableClient.navigate(targetUrl);
    if ("focus" in reusableClient) {
      await reusableClient.focus();
      return;
    }
  }

  await self.clients.openWindow(targetUrl);
}

function parsePushPayload(event) {
  if (!event.data) {
    return null;
  }

  try {
    return event.data.json();
  } catch {
    try {
      return JSON.parse(event.data.text());
    } catch {
      return null;
    }
  }
}

async function hasFocusedAppClient() {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  return clients.some((client) => {
    const url = new URL(client.url);
    const isAppClient = url.pathname === "/app" || url.pathname.startsWith("/app/");
    const isFocused = client.visibilityState === "visible" || client.focused === true;
    return isAppClient && isFocused;
  });
}

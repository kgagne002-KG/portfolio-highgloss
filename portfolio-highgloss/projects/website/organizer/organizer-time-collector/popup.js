const $ = (id) => document.getElementById(id);

async function send(type) {
  return await chrome.runtime.sendMessage({ type });
}

function fmtSeg(seg) {
  if (!seg) return "—";
  const mins = seg.minutes ?? "?";
  return `${mins}m • ${seg.title || "Auto capture"}\n${(seg.startedAtISO || "").slice(11, 16)} → ${(seg.endedAtISO || "").slice(11, 16)}`;
}

async function refresh() {
  const res = await send("GET_STATUS");
  if (!res?.ok) return;

  const tracking = res.current ? `${res.current.url ? "ON" : "ON"}` : "OFF";

  $("trackingState").textContent = tracking;
  $("queueState").textContent = `${res.queueLength || 0} item(s)`;

  // show newest queued item if exists
  $("latest").textContent = fmtSeg(res.queueTop);
}

$("flushBtn").addEventListener("click", async () => {
  await send("FORCE_FLUSH");
  await refresh();
});

$("stopBtn").addEventListener("click", async () => {
  await send("STOP_SEGMENT");
  await refresh();
});

refresh();

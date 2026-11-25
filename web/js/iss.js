/* iss.js — live ISS position (keyless). Visibility-aware polling (§5.1):
   pauses when the tab is hidden, resumes with one immediate refresh. */
async function pollISS() {
  const r = await terraFetch('iss');
  if (r && r.latitude != null) {
    iss.lat = r.latitude; iss.lng = r.longitude; iss.on = true;
    iss.tip = `<b>International Space Station</b><div class="s">${Math.round(r.altitude)} km · ${Math.round(r.velocity)} km/h</div>`;
    if (S.iss) world.pointsData(pointsList());
  }
}
TERRA_NET.poll(pollISS, 8000);

/**
 * Serves the same static public RFP page (rfp-public.html) for any
 * /rfps/{slug} URL. The page itself reads the slug out of the URL on
 * the client side and fetches /api/public/rfps/{slug} for the data.
 *
 * This is what makes "/rfps/nasasps-2027-annual-conference" work as a
 * real, clean URL instead of a query string, without needing a separate
 * static file per RFP.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = "/rfp-public.html";

  // Cloudflare Pages canonicalizes .html <-> clean-URL internally, and
  // which direction it redirects can vary. Rather than guess, follow
  // whatever redirect it hands back ourselves (up to a few hops) so the
  // final HTML is what we return — the browser never sees the redirect,
  // so the slug in the address bar (/rfps/{slug}) is never disturbed.
  let res = await context.env.ASSETS.fetch(new Request(url.toString()));
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && hops < 3) {
    const location = res.headers.get("Location");
    if (!location) break;
    const nextUrl = new URL(location, url);
    res = await context.env.ASSETS.fetch(new Request(nextUrl.toString()));
    hops++;
  }
  return res;
}

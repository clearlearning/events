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
  return context.env.ASSETS.fetch(new Request(url, context.request));
}

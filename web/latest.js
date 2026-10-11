// "Latest wins" for the page's asynchronous city loads (presentation only). A load (a sample
// fetched over the network, a file read, a new city) takes a ticket with start(); when its
// result arrives, it is applied only if its ticket is still the latest. So a slow sample
// cannot overwrite a city the user has since opened or made.
export function createLatest() {
  let current = 0;
  return {
    start() {
      current += 1;
      return current;
    },
    isCurrent(ticket) {
      return ticket === current;
    },
  };
}

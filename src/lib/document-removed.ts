export function documentRemovedMessage(confirmedKept: number): string {
  if (confirmedKept > 0) {
    const facts = confirmedKept === 1 ? "1 accepted fact stays" : `${confirmedKept} accepted facts stay`;
    return `Document removed. ${facts} in your baseline.`;
  }
  return "Document removed.";
}

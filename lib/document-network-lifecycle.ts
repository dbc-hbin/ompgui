export type DocumentNetworkStatus = {
  visible: boolean;
  online: boolean;
};

export type DocumentNetworkTransition = {
  active: boolean;
  catchUp: boolean;
};

export function isDocumentNetworkActive(status: DocumentNetworkStatus): boolean {
  return status.visible && status.online;
}

export function readDocumentNetworkStatus(
  doc: { visibilityState?: string } | null | undefined,
  nav: { onLine?: boolean } | null | undefined,
): DocumentNetworkStatus {
  return {
    visible: doc?.visibilityState !== "hidden",
    online: nav?.onLine !== false,
  };
}

export function nextDocumentNetworkState(
  previousActive: boolean,
  next: DocumentNetworkStatus,
): DocumentNetworkTransition {
  const active = isDocumentNetworkActive(next);
  return {
    active,
    catchUp: active && !previousActive,
  };
}

export function shouldFetchSessionList(status: DocumentNetworkStatus): boolean {
  return isDocumentNetworkActive(status);
}

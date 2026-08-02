/**
 * Graph Mail Source Types
 *
 * Types for the Microsoft Graph mail source (workplan 0023, ADR-0006's
 * IMAP-disabled fallback). Graph API v1.0.
 */

/** Configuration for the Graph mail source connection. */
export interface GraphMailSourceConfig {
  /** Microsoft Graph API base URL (default: https://graph.microsoft.com/v1.0) */
  baseUrl?: string;
  /** Azure AD tenant ID */
  tenantId: string;
}

/** Microsoft Graph mailFolder object (the fields we read). */
export interface GraphMailFolder {
  readonly id: string;
  readonly displayName: string;
  readonly parentFolderId?: string;
  readonly childFolderCount?: number;
  readonly totalItemCount?: number;
}

/** Microsoft Graph message object as returned by the delta $select we issue. */
export interface GraphMessage {
  readonly id: string;
  /** RFC 5322 Message-ID incl. angle brackets — the natural key. May be null. */
  readonly internetMessageId?: string | null;
  readonly receivedDateTime?: string;
  readonly isRead?: boolean;
  readonly isDraft?: boolean;
  readonly flag?: { readonly flagStatus?: 'notFlagged' | 'flagged' | 'complete' };
  /** Present on delta entries for deleted messages; carries no other fields. */
  readonly '@removed'?: { readonly reason: string };
}

/** One page of a Graph collection response. */
export interface GraphPage<T> {
  readonly value: ReadonlyArray<T>;
  readonly '@odata.nextLink'?: string;
  readonly '@odata.deltaLink'?: string;
}

export type ErrorCode = 'invalidIdentifier' | 'queryTooLong' | 'unclosedComment' | 'singleStatement' | 'unclosedText' | 'readOnlyQuery' | 'invalidLimit' | 'connectionClosed' | 'resultTooLarge' | 'unexpectedRead' | 'schemaTooLarge' | 'columnsTooLarge' | 'invalidPage' | 'tableMissing' | 'invalidSort' | 'invalidMessage' | 'noResult' | 'invalidExport' | 'overwriteDatabase' | 'untrustedWorkspace' | 'unsupportedFile' | 'invalidEdit' | 'editingUnavailable' | 'editConflict' | 'pendingEdits' | 'saveAsUnavailable';

/** Stable application error codes are translated only at presentation boundaries. */
export class AppError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = 'AppError'; }
}

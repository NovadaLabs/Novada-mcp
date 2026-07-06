/** Normalize a URL for deduplication: strip trailing slash, www, fragment, sort params */
export declare function normalizeUrl(urlStr: string): string;
/** Filter out boilerplate links (assets, tracking, auth, etc.) */
export declare function isContentLink(href: string): boolean;
//# sourceMappingURL=url.d.ts.map
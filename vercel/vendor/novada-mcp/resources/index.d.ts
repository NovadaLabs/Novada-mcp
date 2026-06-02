interface Resource {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
}
interface ResourceContent {
    uri: string;
    mimeType: string;
    text: string;
}
interface ListResourcesResult {
    resources: Resource[];
}
interface ReadResourceResult {
    contents: ResourceContent[];
}
export declare const RESOURCES: Resource[];
export declare function listResources(): ListResourcesResult;
export declare function readResource(uri: string): ReadResourceResult;
export {};
//# sourceMappingURL=index.d.ts.map
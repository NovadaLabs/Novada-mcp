interface PromptArgument {
    name: string;
    description: string;
    required: boolean;
}
interface Prompt {
    name: string;
    description: string;
    arguments: PromptArgument[];
}
interface PromptMessage {
    role: "user" | "assistant";
    content: {
        type: "text";
        text: string;
    };
}
interface ListPromptsResult {
    prompts: Prompt[];
}
interface GetPromptResult {
    description: string;
    messages: PromptMessage[];
}
export declare const PROMPTS: Prompt[];
export declare function listPrompts(): ListPromptsResult;
export declare function getPrompt(name: string, args: Record<string, string>): GetPromptResult;
export {};
//# sourceMappingURL=index.d.ts.map
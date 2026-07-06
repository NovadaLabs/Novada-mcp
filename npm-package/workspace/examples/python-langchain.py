"""
novada-mcp + LangChain Agent — working example
------------------------------------------------
Prerequisites:
    pip install langchain langchain-anthropic mcp langchain-mcp-adapters

Environment variables required:
    NOVADA_API_KEY       — from dashboard.novada.com
    ANTHROPIC_API_KEY    — from console.anthropic.com

novada-mcp must be installed globally (or via npx):
    npm install -g novada-mcp
"""

import asyncio
import os

from langchain_anthropic import ChatAnthropic
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent


async def main():
    # Step 1: Connect to novada-mcp as an MCP server.
    # langchain-mcp-adapters handles the stdio transport and tool discovery.
    async with MultiServerMCPClient(
        {
            "novada": {
                "command": "npx",
                "args": ["-y", "novada-mcp"],
                "env": {
                    "NOVADA_API_KEY": os.environ["NOVADA_API_KEY"],
                    # Optional: enable JS rendering and Browser CDP
                    # "NOVADA_WEB_UNBLOCKER_KEY": os.environ.get("NOVADA_WEB_UNBLOCKER_KEY", ""),
                    # "NOVADA_BROWSER_WS": os.environ.get("NOVADA_BROWSER_WS", ""),
                },
                "transport": "stdio",
            }
        }
    ) as client:
        # Step 2: Get all novada tools as LangChain-compatible tools.
        # The adapter wraps each MCP tool (novada_search, novada_extract, etc.)
        # into a LangChain BaseTool automatically.
        tools = client.get_tools()

        print(f"Loaded {len(tools)} novada tools:")
        for t in tools:
            print(f"  - {t.name}")

        # Step 3: Create a ReAct agent backed by Claude.
        # The agent will autonomously pick which novada tools to call.
        llm = ChatAnthropic(
            model="claude-sonnet-4-5",
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )
        agent = create_react_agent(llm, tools)

        # Step 4: Run a research query.
        # The agent will call novada_search, then novada_extract on relevant
        # results — all in a single agent loop.
        print("\n--- Search + Extract example ---")
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Search for 'best open source MCP servers 2025' and extract "
                            "the full content from the top result. Summarize in 3 bullet points."
                        ),
                    }
                ]
            }
        )
        print(result["messages"][-1].content)

        # Step 5: Inline search + extract in one tool call (extract_options).
        # novada_search accepts extract_options to auto-fetch content from top-N
        # results, eliminating a second round-trip. More token-efficient.
        print("\n--- Single-call search+extract ---")
        result2 = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Use novada_search with extract_options set to top_n=2 "
                            "to search for 'firecrawl vs tavily comparison' and summarize "
                            "what you find from the extracted content."
                        ),
                    }
                ]
            }
        )
        print(result2["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())

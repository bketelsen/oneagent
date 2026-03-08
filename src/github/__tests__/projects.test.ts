import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubProjectsClient } from "../projects.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
const mockExecFileSync = vi.mocked(execFileSync);

describe("GitHubProjectsClient", () => {
  let client: GitHubProjectsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GitHubProjectsClient();
  });

  describe("fetchProjectItems", () => {
    it("parses GraphQL response and returns Issue items only", () => {
      const graphqlResponse = {
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: "PVTI_item1",
                  fieldValues: {
                    nodes: [
                      {
                        __typename: "ProjectV2ItemFieldSingleSelectValue",
                        name: "In Progress",
                      },
                    ],
                  },
                  content: {
                    __typename: "Issue",
                    number: 42,
                    title: "Fix the bug",
                    body: "Something is broken",
                    repository: {
                      owner: { login: "acme" },
                      name: "widgets",
                    },
                    labels: {
                      nodes: [{ name: "bug" }, { name: "priority:high" }],
                    },
                  },
                },
                {
                  id: "PVTI_item2",
                  fieldValues: { nodes: [] },
                  content: {
                    __typename: "DraftIssue",
                    title: "Draft idea",
                  },
                },
                {
                  id: "PVTI_item3",
                  fieldValues: { nodes: [] },
                  content: {
                    __typename: "Issue",
                    number: 10,
                    title: "Add feature",
                    body: "",
                    repository: {
                      owner: { login: "acme" },
                      name: "widgets",
                    },
                    labels: { nodes: [] },
                  },
                },
              ],
            },
          },
        },
      };

      mockExecFileSync.mockReturnValue(JSON.stringify(graphqlResponse));

      const items = client.fetchProjectItems("PVT_project1");

      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({
        itemId: "PVTI_item1",
        issueNumber: 42,
        title: "Fix the bug",
        body: "Something is broken",
        owner: "acme",
        repo: "widgets",
        labels: ["bug", "priority:high"],
        status: "In Progress",
      });
      expect(items[1]).toEqual({
        itemId: "PVTI_item3",
        issueNumber: 10,
        title: "Add feature",
        body: "",
        owner: "acme",
        repo: "widgets",
        labels: [],
        status: undefined,
      });
    });

    it("calls gh api graphql with correct arguments", () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          data: { node: { items: { nodes: [] } } },
        }),
      );

      client.fetchProjectItems("PVT_abc123");

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining([
          "api",
          "graphql",
          "-f",
          expect.stringContaining("query("),
          "-f",
          "projectId=PVT_abc123",
        ]),
        { encoding: "utf-8" },
      );
    });
  });

  describe("fetchStatusField", () => {
    it("returns the Status field and its options", () => {
      const graphqlResponse = {
        data: {
          node: {
            fields: {
              nodes: [
                { name: "Title" },
                {
                  id: "PVTSSF_field1",
                  name: "Status",
                  options: [
                    { id: "opt1", name: "Todo" },
                    { id: "opt2", name: "In Progress" },
                    { id: "opt3", name: "Done" },
                  ],
                },
                { name: "Assignees" },
              ],
            },
          },
        },
      };

      mockExecFileSync.mockReturnValue(JSON.stringify(graphqlResponse));

      const result = client.fetchStatusField("PVT_project1");

      expect(result).toEqual({
        fieldId: "PVTSSF_field1",
        options: [
          { id: "opt1", name: "Todo" },
          { id: "opt2", name: "In Progress" },
          { id: "opt3", name: "Done" },
        ],
      });
    });

    it("returns null when no Status field exists", () => {
      const graphqlResponse = {
        data: {
          node: {
            fields: {
              nodes: [{ name: "Title" }, { name: "Assignees" }],
            },
          },
        },
      };

      mockExecFileSync.mockReturnValue(JSON.stringify(graphqlResponse));

      const result = client.fetchStatusField("PVT_project1");

      expect(result).toBeNull();
    });
  });

  describe("updateItemStatus", () => {
    it("calls execFileSync with mutation without throwing", () => {
      mockExecFileSync.mockReturnValue(
        JSON.stringify({
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: "PVTI_item1" },
            },
          },
        }),
      );

      expect(() =>
        client.updateItemStatus(
          "PVT_project1",
          "PVTI_item1",
          "PVTSSF_field1",
          "opt2",
        ),
      ).not.toThrow();

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining([
          "api",
          "graphql",
          "-f",
          expect.stringContaining("mutation("),
          "-f",
          "projectId=PVT_project1",
          "-f",
          "itemId=PVTI_item1",
          "-f",
          "fieldId=PVTSSF_field1",
          "-f",
          "optionId=opt2",
        ]),
        { encoding: "utf-8" },
      );
    });
  });
});

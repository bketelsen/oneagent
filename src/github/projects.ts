import { execFileSync } from "node:child_process";

export interface ProjectItem {
  itemId: string;
  issueNumber: number;
  title: string;
  body: string;
  owner: string;
  repo: string;
  labels: string[];
  status?: string;
}

export interface StatusField {
  fieldId: string;
  options: Array<{ id: string; name: string }>;
}

export class GitHubProjectsClient {
  private graphql(query: string, variables?: Record<string, string>): unknown {
    const args = ["api", "graphql", "-f", `query=${query}`];
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        args.push("-f", `${key}=${value}`);
      }
    }
    const result = execFileSync("gh", args, { encoding: "utf-8" });
    return JSON.parse(result);
  }

  fetchProjectItems(projectId: string): ProjectItem[] {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      __typename
                      name
                    }
                  }
                }
                content {
                  __typename
                  ... on Issue {
                    number
                    title
                    body
                    repository {
                      owner {
                        login
                      }
                      name
                    }
                    labels(first: 20) {
                      nodes {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = this.graphql(query, { projectId }) as {
      data: {
        node: {
          items: {
            nodes: Array<{
              id: string;
              fieldValues: {
                nodes: Array<{ __typename?: string; name?: string }>;
              };
              content: {
                __typename: string;
                number?: number;
                title?: string;
                body?: string;
                repository?: {
                  owner: { login: string };
                  name: string;
                };
                labels?: { nodes: Array<{ name: string }> };
              };
            }>;
          };
        };
      };
    };

    const items = response.data.node.items.nodes;
    return items
      .filter((item) => item.content.__typename === "Issue")
      .map((item) => {
        const content = item.content;
        const statusField = item.fieldValues.nodes.find(
          (fv) => fv.__typename === "ProjectV2ItemFieldSingleSelectValue",
        );
        return {
          itemId: item.id,
          issueNumber: content.number!,
          title: content.title!,
          body: content.body ?? "",
          owner: content.repository!.owner.login,
          repo: content.repository!.name,
          labels: (content.labels?.nodes ?? []).map((l) => l.name),
          status: statusField?.name,
        };
      });
  }

  fetchStatusField(projectId: string): StatusField | null {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 50) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = this.graphql(query, { projectId }) as {
      data: {
        node: {
          fields: {
            nodes: Array<{
              id?: string;
              name?: string;
              options?: Array<{ id: string; name: string }>;
            }>;
          };
        };
      };
    };

    const fields = response.data.node.fields.nodes;
    const statusField = fields.find(
      (f) => f.name === "Status" && f.options !== undefined,
    );
    if (!statusField) return null;

    return {
      fieldId: statusField.id!,
      options: statusField.options!,
    };
  }

  updateItemStatus(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): void {
    const query = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `;

    this.graphql(query, { projectId, itemId, fieldId, optionId });
  }
}

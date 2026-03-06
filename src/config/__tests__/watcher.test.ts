import { describe, it, expect, vi } from "vitest";
import { ConfigWatcher } from "../watcher.js";

describe("ConfigWatcher", () => {
  it("calls onChange when config string changes", () => {
    const onChange = vi.fn();
    const watcher = new ConfigWatcher(onChange);
    watcher.handleFileChange("github:\n  repos:\n    - owner: a\n      repo: b\n      labels: [x]");
    expect(onChange).toHaveBeenCalled();
  });

  it("does not call onChange if parse fails", () => {
    const onChange = vi.fn();
    const watcher = new ConfigWatcher(onChange);
    watcher.handleFileChange("invalid: [[[");
    expect(onChange).not.toHaveBeenCalled();
  });
});

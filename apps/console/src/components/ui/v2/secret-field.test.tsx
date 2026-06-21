import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretField } from "./secret-field";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SecretField", () => {
  it("masks all but the last four characters by default", () => {
    render(<SecretField value="sh_live_abcd1234" />);
    expect(screen.getByText(/•+1234$/)).toBeInTheDocument();
  });

  it("reveals the value when the eye is toggled", async () => {
    render(<SecretField value="sh_live_abcd1234" />);
    await userEvent.click(screen.getByTitle("Revelar"));
    expect(screen.getByText("sh_live_abcd1234")).toBeInTheDocument();
  });

  it("copies the value to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SecretField value="sh_live_abcd1234" />);
    await userEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith("sh_live_abcd1234");
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
  });
});

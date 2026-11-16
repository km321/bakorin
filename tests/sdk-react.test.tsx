/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { BakorinClient } from "@bakorin/sdk";
import type { AppSchema } from "@bakorin/sdk/headless";
import { BakorinProvider, DataTable, FileUpload, Gate, LiveList, RecordForm, SignInForm, SignUpForm, UserMenu } from "@bakorin/sdk/react";

const schema: AppSchema = {
  entities: {
    users: {
      name: "users",
      display: "name",
      fields: [
        { name: "id", type: "text", system: true, writable: "none" },
        { name: "email", type: "email", required: true },
        { name: "password", type: "password", required: true, secret: true },
        { name: "name", type: "text", required: true },
        { name: "role", type: "enum", enumValues: ["user", "admin"], writable: "admin" },
      ],
    },
    tasks: {
      name: "tasks",
      display: "title",
      fields: [
        { name: "id", type: "text", system: true, writable: "none" },
        { name: "title", type: "text", required: true },
        { name: "done", type: "boolean", defaultValue: false },
        { name: "kind", type: "enum", enumValues: ["home", "work"] },
        { name: "attachment", type: "file" },
        { name: "ownerId", type: "relation", relation: { to: "users" }, owner: true },
      ],
    },
  },
  auth: { entity: "users", identityField: "email", passwordField: "password" },
};

const client = { entity: () => ({ list: async () => ({ data: [], meta: { total: 0, limit: 20, offset: 0 } }) }) } as unknown as BakorinClient;
const page = (node: React.ReactNode, user: Record<string, unknown> | null = null) =>
  renderToString(
    <BakorinProvider client={client} schema={schema} initialUser={user}>
      {node}
    </BakorinProvider>,
  );

describe("React components render accessible markup on the server", () => {
  test("SignInForm labels its inputs and sets autocomplete", () => {
    const html = page(<SignInForm forgotPasswordHref="/forgot" signUpHref="/signup" />);
    expect(html).toMatch(/<label class="bk-label" for="([^"]+)">Email/);
    const id = /<label class="bk-label" for="([^"]+)">Email/.exec(html)![1];
    expect(html).toContain(`id="${id}"`);
    expect(html.toLowerCase()).toContain('autocomplete="current-password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/forgot"');
  });

  test("SignUpForm asks only for fields people may set", () => {
    const html = page(<SignUpForm />);
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="name"');
    expect(html).not.toContain('name="role"');
  });

  test("RecordForm builds inputs from the schema and skips owner fields", () => {
    const html = page(<RecordForm entity="tasks" />);
    expect(html).toContain('name="title"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<option value=\"home\">home</option>");
    expect(html).toContain('class="bk-dropzone"');
    expect(html).not.toContain('name="ownerId"');
    expect(html).toContain(">Create</button>");
  });

  test("DataTable has a caption, column headers, sort buttons, and a labelled pager", () => {
    const html = page(
      <DataTable
        entity="tasks"
        columns={["title", "done"]}
        toggle={["done"]}
        deletable
        initial={{ data: [{ id: "t1", title: "Ship", done: true }], meta: { total: 1, limit: 20, offset: 0 } }}
      />,
    );
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
    expect(html).toContain('class="bk-sort"');
    expect(html).toContain('aria-label="Done: Ship"');
    expect(html).toContain('aria-label="Delete Ship"');
    expect(html).toContain('aria-label="Tasks pages"');
    expect(html).toContain('aria-live="polite">1 to 1 of 1</span>');
  });

  test("UserMenu, Gate, LiveList, and FileUpload", () => {
    const signedIn = page(
      <>
        <UserMenu links={[{ href: "/account", label: "Account" }]} />
        <Gate fallback={<p>Please sign in</p>}>
          <p>Secret stuff</p>
        </Gate>
      </>,
      { id: "u1", name: "Kit", email: "kit@example.test" },
    );
    expect(signedIn).toContain('aria-expanded="false"');
    expect(signedIn).toContain("Kit");
    expect(signedIn).toContain("Secret stuff");
    const signedOut = page(
      <>
        <UserMenu />
        <Gate fallback={<p>Please sign in</p>}>
          <p>Secret stuff</p>
        </Gate>
      </>,
    );
    expect(signedOut).toContain(">Sign in</a>");
    expect(signedOut).toContain("Please sign in");
    expect(signedOut).not.toContain("Secret stuff");
    expect(page(<LiveList entity="tasks" initial={{ data: [{ id: "1", title: "A" }], meta: { total: 1, limit: 20, offset: 0 } }} />)).toContain('role="status"');
    const upload = page(<FileUpload maxBytes={1024} accept="image/*" />);
    expect(upload).toContain('type="file"');
    expect(upload).toContain("Up to 1 KB.");
  });
});

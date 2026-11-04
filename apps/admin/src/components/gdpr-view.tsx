"use client";

/**
 * FILE: apps/admin/src/components/gdpr-view.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console screen for GDPR requests (people asking FundHub to export or erase their personal
 *   data). It lists every request in a table with its legal due date, and opens a side panel (Drawer) where staff
 *   can download all data held about the person as JSON, erase/anonymise it, change the request's status and
 *   keep resolution notes as evidence.
 * WHERE IT RUNS: in the browser ("use client"), because it keeps interactive state (which request is open,
 *   the notes being typed) and reacts to clicks. The data itself (`rows`) is loaded on the server by the page
 *   that renders this component and passed in as a prop.
 * FRAMEWORK NOTES:
 *   - React component = a function returning JSX (HTML-like markup). Its inputs are "props".
 *   - `useState` is a React hook that remembers a value between re-renders; calling its setter re-draws the screen.
 *   - antd components used: Card (boxed panel with a title), Table (data grid with `columns` + `dataSource`),
 *     Drawer (panel sliding in from the right), Popconfirm ("are you sure?" bubble), Select (dropdown),
 *     Tag (coloured label), Alert (info banner), Space (lays children out with gaps), Typography (text styles).
 *   - The buttons call server actions (functions in "@/lib/gdpr-actions" that run on the server) through the
 *     `useAction` hook, which shows a success/error toast and refreshes the page data afterwards.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `export type X = { … }` object type alias; `Record<string, string>` (an object mapping text keys to text).
 *   - generics: `useState<GdprRow | null>` and `<Table<GdprRow>>` tell the function/component which type it holds.
 *   - union `GdprRow | null`, arrow functions, async/await, template strings `` `GDPR-${id}` ``.
 *   - `!!value` (turns any value into true/false), spread `{ ...open, status }`, `&&`, `||`, ternary `c ? x : y`.
 */

// `import { a } from "b"` brings named things in from another module. Plain names are npm libraries;
// `@fundhub/…` are FundHub's own shared packages (packages/ folder); `@/…` is this app's src folder;
// `./x` is a file in the same folder.
// React's `useState` hook, for remembering which request is open and the notes text.
import { useState } from "react";
// Ant Design UI components used to build the screen (see FRAMEWORK NOTES above).
import { Alert, Button, Card, Drawer, Input, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
// A download-arrow icon from antd's icon set.
import { DownloadOutlined } from "@ant-design/icons";
// dayjs: a small date library, used to format dates and count days until the deadline.
// `import x from "y"` (no braces) takes the module's single "default" export.
import dayjs from "dayjs";
// The list of allowed GDPR request statuses, shared with the database and website so they always agree.
import { GDPR_REQUEST_STATUSES } from "@fundhub/core/enums";
// Server actions: export all data for an email, erase it, and update a request's status/notes.
import { erasePersonalData, exportPersonalData, updateGdprRequest } from "@/lib/gdpr-actions";
// Our helper that saves text as a downloaded file in the browser.
import { downloadText } from "./download";
// Our hook that runs a server action, shows a toast and refreshes the data.
import { useAction } from "./use-action";

/**
 * Kind: type alias (exported so the server page that loads the data can use the same shape).
 * One GDPR request as shown in the table: numeric `id`, requester `email` and `name`, request `type`
 * (e.g. export or erasure), free-text `details`, `status`, `dueAt` (legal deadline), staff `resolution` notes,
 * and `createdAt`. Dates are strings (ISO text) because data passed from server to browser must be plain text/JSON.
 */
export type GdprRow = { id: number; email: string; name: string; type: string; details: string; status: string; dueAt: string; resolution: string; createdAt: string };
/**
 * Kind: constant.
 * Maps each status to an antd Tag colour. `Record<string, string>` = an object whose keys and values are strings.
 * Open statuses are orange/blue so they stand out; finished ones are green or grey ("default").
 */
const STATUS_COLOR: Record<string, string> = { received: "orange", verifying: "blue", completed: "green", rejected: "default" };

/**
 * Kind: React component.
 * @param rows  type `GdprRow[]` (an array of GdprRow) — all GDPR requests, loaded by the server page.
 *              `{ rows }: { rows: GdprRow[] }` destructures the single prop out of the props object.
 * @returns JSX: a Card holding an info banner, the requests table and the detail Drawer.
 * Why: GDPR (Art. 12(3)) requires an answer within one month, so the table highlights requests close to the deadline.
 */
export function GdprView({ rows }: { rows: GdprRow[] }) {
  // `run(fn)` executes a server action with toast + refresh; `pending` is true while it is running.
  const { run, pending } = useAction();
  // The request currently opened in the Drawer, or `null` when the Drawer is closed.
  // `useState` returns [current value, setter function]; `<GdprRow | null>` states what type it may hold.
  const [open, setOpen] = useState<GdprRow | null>(null);
  // The text in the "Resolution notes" box, kept separately so staff can edit it before saving.
  const [resolution, setResolution] = useState("");

  /**
   * Kind: async arrow function.
   * Asks the server for every piece of data held about `email` (`await` waits for the JSON text), then
   * downloads it as a file named e.g. "fundhub-data-jane@example.com.json".
   */
  const exportFor = async (email: string) => {
    downloadText(`fundhub-data-${email}.json`, await exportPersonalData(email), "application/json");
  };

  // The JSX below is what appears on screen. `extra={…}` puts content in the Card's top-right corner.
  return (
    <Card title="GDPR requests" extra={<Typography.Text type="secondary">Answer within one month (Art. 12(3) GDPR)</Typography.Text>}>
      {/* Blue info banner reminding staff of the manual checks and the other systems that also hold data. */}
      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="Verify the requester owns the email (reply to the confirmation email) before exporting or erasing. Erasure here covers FundHub's database; also remove the person from the CRM (Twenty), newsletter (Listmonk) and Stripe."
      />
      {/* The requests table. `<Table<GdprRow>>` tells TypeScript each row is a GdprRow; `rowKey="id"` gives React a
          unique key per row; `dataSource` = the rows; 25 rows per page. Each entry in `columns` describes one
          column: `title` = header, `dataIndex` = which field to show, `render(value, row)` = custom display. */}
      <Table<GdprRow>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 25 }}
        columns={[
          { title: "Ref", dataIndex: "id", render: (id: number) => `GDPR-${id}` },
          { title: "Email", dataIndex: "email" },
          { title: "Type", dataIndex: "type", render: (t: string) => <Tag>{t}</Tag> },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
          {
            title: "Due",
            dataIndex: "dueAt",
            render: (d: string, r) => {
              // Whole days from now until the deadline (negative if it has passed).
              const days = dayjs(d).diff(dayjs(), "day");
              // A request still needs work while it is "received" or "verifying" (`||` = or).
              const open = r.status === "received" || r.status === "verifying";
              // Show the date in red when an open request is due in under 7 days (`undefined` = normal colour),
              // and add "(Nd)" days-left text only for open requests.
              return <span style={{ color: open && days < 7 ? "#b91c1c" : undefined }}>{dayjs(d).format("D MMM YYYY")}{open ? ` (${days}d)` : ""}</span>;
            },
          },
          // Last column: an "Open" button that remembers this row as the open one and copies its saved notes.
          // `_` is a conventional name for a parameter we do not use (here the cell value).
          { title: "", render: (_, r) => <Button size="small" onClick={() => { setOpen(r); setResolution(r.resolution); }}>Open</Button> },
        ]}
      />
      {/* Side panel. `!!open` converts the open row (or null) into true/false; closing sets it back to null. */}
      <Drawer open={!!open} onClose={() => setOpen(null)} width={520} title={open ? `GDPR-${open.id} · ${open.type}` : ""}>
        {/* `open && (…)` only renders the contents when a request is open, so `open.email` etc. are safe to use. */}
        {open && (
          <Space direction="vertical" style={{ width: "100%" }}>
            {/* `open.name || "(no name)"` shows the fallback text when the name is empty. */}
            <Typography.Text>{open.name || "(no name)"} · {open.email}</Typography.Text>
            {open.details && <Typography.Paragraph type="secondary">“{open.details}”</Typography.Paragraph>}
            <Space wrap>
              {/* Export: downloads the person's data as a JSON file (calls the server, then downloadText). */}
              <Button icon={<DownloadOutlined />} onClick={() => exportFor(open.email)}>Export all data (JSON)</Button>
              {/* Erase: Popconfirm asks "are you sure?" first; only on confirm does it run the server action. */}
              <Popconfirm title="Erase this person's data? This can't be undone." onConfirm={() => run(() => erasePersonalData(open.email))}>
                <Button danger loading={pending}>Erase / anonymise</Button>
              </Popconfirm>
            </Space>
            <Typography.Text strong style={{ marginTop: 12 }}>Status</Typography.Text>
            {/* Status dropdown. On change it saves the new status (with the current notes) on the server, and also
                updates the open copy locally: `{ ...open, status }` = a copy of `open` with `status` replaced.
                `options` is built with `.map`, which turns each status into a `{ value, label }` object. */}
            <Select value={open.status} style={{ width: 200 }} onChange={(status) => { run(() => updateGdprRequest({ id: open.id, status, resolution })); setOpen({ ...open, status }); }}
              options={GDPR_REQUEST_STATUSES.map((s) => ({ value: s, label: s }))} />
            <Typography.Text strong>Resolution notes (kept as evidence)</Typography.Text>
            {/* A "controlled" text box: it shows `resolution` and each keystroke (`e.target.value`) updates it. */}
            <Input.TextArea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} />
            <Button onClick={() => run(() => updateGdprRequest({ id: open.id, status: open.status, resolution }))}>Save notes</Button>
          </Space>
        )}
      </Drawer>
    </Card>
  );
}

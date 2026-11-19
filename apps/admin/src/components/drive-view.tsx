"use client";
/**
 * FILE: apps/admin/src/components/drive-view.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Drive page's content: a button that opens FundHub's internal drive in a new tab. The drive
 *   lives on the Azure VM behind the VM's 2FA login (Authelia), which browsers do not allow inside another site's
 *   frame, so it is opened rather than embedded.
 * WHERE IT RUNS: in the browser.
 */

import { ExportOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";

/**
 * Kind: React component.
 * @param url  type `string` — the drive opened on the shared FundHub folder (from src/lib/drive.ts).
 */
export function DriveView({ url }: { url: string }) {
  return (
    <Card style={{ maxWidth: 640 }}>
      <Space direction="vertical" size={12}>
        <Space size={12} align="center">
          <FolderOpenOutlined style={{ fontSize: 28 }} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            FundHub Drive
          </Typography.Title>
        </Space>
        <Typography.Paragraph style={{ margin: 0 }}>
          Internal files: finance and receipts, clients, providers, legal, marketing. Opens in a new tab and uses the
          VM login (password + authenticator code), the same as the code editor.
        </Typography.Paragraph>
        <Button type="primary" size="large" icon={<ExportOutlined />} href={url} target="_blank" rel="noreferrer">
          Open Drive
        </Button>
      </Space>
    </Card>
  );
}

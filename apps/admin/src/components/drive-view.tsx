"use client";
/**
 * FILE: apps/admin/src/components/drive-view.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Shows the internal drive in a frame that fills the page, with "Open in new tab" (some
 *   browsers block sign-in cookies inside frames; the new tab always works). Without a URL: setup help.
 * WHERE IT RUNS: in the browser.
 */

import { ExportOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Typography } from "antd";

/**
 * Kind: React component.
 * @param url  type `string | null` — the drive's address (ends with "/"), or null when not configured.
 */
export function DriveView({ url }: { url: string | null }) {
  if (!url)
    return (
      <Alert
        type="info"
        showIcon
        message="Drive not configured"
        description="Set DRIVE_URL on the admin project (e.g. https://<vm-domain>/drive) after installing the drive on the VM. See docs/operations.md → Drive."
      />
    );
  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Drive
        </Typography.Title>
        <Button icon={<ExportOutlined />} href={url} target="_blank" rel="noreferrer">
          Open in new tab
        </Button>
      </Space>
      <iframe
        src={url}
        title="FundHub Drive"
        style={{ width: "100%", height: "calc(100vh - 170px)", minHeight: 480, border: "1px solid rgba(128,128,128,.25)", borderRadius: 8 }}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </Space>
  );
}

import React from "react";
export function Page({ title, children }: { title: string; width?: string; children: any }) {
  return <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 10px 40px" }}><h1 style={{ fontSize: 19, margin: "4px 0 8px", fontWeight: 700 }}>{title}</h1>{children}</div>;
}
export function Callout({ lead, children }: { lead?: string; children: any }) {
  return <div style={{ borderLeft: "4px solid #f59e0b", background: "rgba(245,158,11,.08)", padding: "8px 12px", borderRadius: 6, margin: "10px 0", fontSize: 13, lineHeight: 1.5 }}>{lead ? <b style={{ color: "#f59e0b" }}>{lead}: </b> : null}{children}</div>;
}

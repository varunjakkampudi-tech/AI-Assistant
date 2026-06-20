// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>ORA OS — AI Operating System for Life</title>
        <meta name="description" content="ORA OS is a cinematic personal AI: daily briefings, finance tracking from Gmail, health logging, career copilot, timeline, memory, and voice chat in one beautifully dark, gold-glow app." />
        <meta name="keywords" content="AI assistant, personal AI, daily briefing, finance tracker, health tracker, career copilot, life dashboard, voice AI, ORA, ORA OS" />
        <meta name="theme-color" content="#0a0a0c" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ORA OS" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="ORA OS — Personal AI for Life" />
        <meta property="og:description" content="A calm, gold-glow AI that runs your day: briefings, finance, health, career, memory, voice." />
        <meta property="og:image" content="/assets/images/icon.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="ORA OS — Personal AI for Life" />
        <meta name="twitter:description" content="A calm, gold-glow AI that runs your day." />
        <link rel="canonical" href="https://oraos.app" />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </body>
    </html>
  );
}

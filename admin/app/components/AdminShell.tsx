"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CheckCircle2, ChevronRight, ListChecks, MessageSquare, Plug, Settings, Wrench } from "lucide-react";
import logo from "../../logo.png";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isGeneralRoute = pathname === "/general" || pathname.startsWith("/language-models");
  const isAgentRoute = pathname.startsWith("/general/agent");
  const isDiscordRoute = pathname.startsWith("/platforms/discord");
  const isGithubRoute = pathname.startsWith("/platforms/github");
  const isSlackRoute = pathname.startsWith("/platforms/slack");
  const isAsanaRoute = pathname.startsWith("/platforms/asana");

  return (
    <main className="admin-shell">
      <aside className="sidebar" aria-label="Admin navigation">
        <div className="brand">
          <Image src={logo} alt="Alshival logo" width={42} height={42} priority />
          <div>
            <p className="brand-kicker">Admin</p>
            <h1>Alshival</h1>
          </div>
        </div>

        <nav className="nav">
          <Link
            className={`nav-item ${isGeneralRoute ? "selected" : ""}`}
            href="/general"
          >
            <Settings size={18} />
            <span>General</span>
            <ChevronRight size={15} />
          </Link>
          {isGeneralRoute ? (
            <div className="nav-subgroup top-level-subgroup" aria-label="General navigation">
              <Link
                className={`nav-subitem ${pathname === "/general" ? "active" : ""}`}
                href="/general"
              >
                Overview
              </Link>
              <Link
                className={`nav-subitem ${pathname === "/language-models" ? "active" : ""}`}
                href="/language-models"
              >
                Language Models
              </Link>
            </div>
          ) : null}
          <Link
            className={`nav-item ${isAgentRoute ? "active" : ""}`}
            href="/general/agent"
          >
            <Bot size={18} />
            <span>Agent</span>
          </Link>
          <Link
            className={`nav-item ${pathname === "/mcp" ? "active" : ""}`}
            href="/mcp"
          >
            <Wrench size={18} />
            <span>MCP</span>
          </Link>
          <div className="nav-group">
            <div className="nav-label">
              <Plug size={16} />
              <span>Platforms</span>
            </div>
            <Link
              className={`nav-item nested ${isDiscordRoute ? "selected" : ""}`}
              href="/platforms/discord/global-settings"
            >
              <MessageSquare size={17} />
              <span>Discord</span>
              <ChevronRight size={15} />
            </Link>
            {isDiscordRoute ? (
              <div className="nav-subgroup" aria-label="Discord navigation">
                <Link
                  className={`nav-subitem ${
                    pathname === "/platforms/discord/global-settings" ? "active" : ""
                  }`}
                  href="/platforms/discord/global-settings"
                >
                  Global Settings
                </Link>
                <Link
                  className={`nav-subitem ${
                    pathname === "/platforms/discord/guilds" ? "active" : ""
                  }`}
                  href="/platforms/discord/guilds"
                >
                  Guilds
                </Link>
              </div>
            ) : null}
            <Link
              className={`nav-item nested ${isSlackRoute ? "selected" : ""}`}
              href="/platforms/slack/global-settings"
            >
              <MessageSquare size={17} />
              <span>Slack</span>
              <ChevronRight size={15} />
            </Link>
            {isSlackRoute ? (
              <div className="nav-subgroup" aria-label="Slack navigation">
                <Link
                  className={`nav-subitem ${
                    pathname === "/platforms/slack/global-settings" ? "active" : ""
                  }`}
                  href="/platforms/slack/global-settings"
                >
                  Global Settings
                </Link>
                <Link
                  className={`nav-subitem ${
                    pathname === "/platforms/slack/workspaces" ? "active" : ""
                  }`}
                  href="/platforms/slack/workspaces"
                >
                  Workspaces
                </Link>
                <Link
                  className={`nav-subitem ${
                    pathname === "/platforms/slack/channels" ? "active" : ""
                  }`}
                  href="/platforms/slack/channels"
                >
                  Channels
                </Link>
              </div>
            ) : null}
            <Link
              className={`nav-item nested ${isGithubRoute ? "selected" : ""}`}
              href="/platforms/github/global-settings"
            >
              <Image alt="" className="nav-icon" height={17} src="/github.svg" width={17} />
              <span>GitHub</span>
              <ChevronRight size={15} />
            </Link>
            {isGithubRoute ? (
              <div className="nav-subgroup" aria-label="GitHub navigation">
                <Link
                  className={`nav-subitem ${
                    pathname === "/platforms/github/global-settings" ? "active" : ""
                  }`}
                  href="/platforms/github/global-settings"
                >
                  Global Settings
                </Link>
              </div>
            ) : null}
            <Link
              className={`nav-item nested ${isAsanaRoute ? "selected" : ""}`}
              href="/platforms/asana/global-settings"
            >
              <ListChecks size={17} />
              <span>Asana</span>
              <ChevronRight size={15} />
            </Link>
            {isAsanaRoute ? (
              <div className="nav-subgroup" aria-label="Asana navigation">
                <Link
                  className={`nav-subitem ${
                    pathname === "/platforms/asana/global-settings" ? "active" : ""
                  }`}
                  href="/platforms/asana/global-settings"
                >
                  Global Settings
                </Link>
              </div>
            ) : null}
          </div>
        </nav>

        <div className="sidebar-status">
          <CheckCircle2 size={18} />
          <div>
            <strong>Ready</strong>
            <span>Local configuration</span>
          </div>
        </div>
      </aside>

      <section className="content">{children}</section>
    </main>
  );
}

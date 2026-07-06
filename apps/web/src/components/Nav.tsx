import * as React from "react";
import Link from "next/link";

const links = [
  { href: "/find", label: "Find (A)" },
  { href: "/pass", label: "Pass along" },
  { href: "/provider/p1", label: "Provider profile (C)" },
  { href: "/directions", label: "Concept directions" }
];

export function Nav() {
  return (
    <header className="pa-nav">
      <div className="pa-nav-in">
        <Link className="pa-logo" href="/">
          Pass Along
        </Link>
        <nav className="pa-nav-links">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

import Link from "next/link";

const links = [
  { href: "/", label: "Directions" },
  { href: "/find", label: "Find (A)" },
  { href: "/pass", label: "Pass along" },
  { href: "/provider/p1", label: "Provider profile (C)" },
  { href: "/admin", label: "Admin" }
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

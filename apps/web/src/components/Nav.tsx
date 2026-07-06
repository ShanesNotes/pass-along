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
    <nav
      style={{
        display: "flex",
        gap: "1.25rem",
        padding: "12px 16px",
        borderBottom: "1px solid #ddd",
        fontSize: "0.9rem"
      }}
    >
      {links.map((link) => (
        <Link key={link.href} href={link.href} style={{ color: "#333" }}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

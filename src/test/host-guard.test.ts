import { describe, expect, it } from "vitest";
import { isPrivateIp, mailHostProblem } from "../../supabase/functions/_shared/host-guard";

describe("host-guard (SSRF en hosts de correo)", () => {
  it("rechaza IPs internas", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["212.227.17.13", "8.8.8.8", "172.32.0.1", "2a01:111:f403::1"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("acepta servidores de correo reales y puertos de correo", () => {
    expect(mailHostProblem("smtp.ionos.es", 465)).toBeNull();
    expect(mailHostProblem("imap.ionos.es", 993)).toBeNull();
    expect(mailHostProblem("smtp.gmail.com", 587)).toBeNull();
    expect(mailHostProblem("smtp.office365.com", "587")).toBeNull();
  });
  it("rechaza nombres internos, IPs internas y puertos raros", () => {
    expect(mailHostProblem("localhost", 465)).not.toBeNull();
    expect(mailHostProblem("metadata.google.internal", 80)).not.toBeNull();
    expect(mailHostProblem("169.254.169.254", 465)).not.toBeNull();
    expect(mailHostProblem("smtp.ionos.es", 8080)).not.toBeNull();
    expect(mailHostProblem("smtp.ionos.es", 5432)).not.toBeNull();
    expect(mailHostProblem("", 465)).not.toBeNull();
  });
});

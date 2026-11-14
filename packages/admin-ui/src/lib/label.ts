export function fieldLabel(name: string): string {
  return name.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

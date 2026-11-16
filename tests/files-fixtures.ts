/** Projects with a file field, an owner, and a many to many list of members. */
export const FILES_YAML = `
app:
  name: files-app
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:
    path: ./data/uploads
    allowedMimeTypes: ["*"]
  jwt:
    secret: test-jwt-secret-0123456789-abcdefghijklmnop
  hooks: ./hooks.ts
auth:
  entity: users
  adminRole: admin
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      name: { type: text, required: true }
      role: { type: enum, values: [user, admin], default: user }
    policies:
      read: authenticated
      create: public
      update: owner(id)
      delete: admin
  projects:
    display: name
    fields:
      name: { type: text, required: true }
      brief: { type: file }
      ownerId: { type: relation, to: users }
      memberIds: { type: relation, to: users, many: true }
      legacy: { type: text }
    policies:
      read: authenticated
      create: authenticated
      update: authenticated
      delete: admin
`;

FROM oven/bun:1.4
WORKDIR /bakorin
COPY .bakorin/package.json ./
COPY .bakorin/packages ./packages
RUN bun install
WORKDIR /project
COPY app.yaml hooks.ts ./
COPY branding ./branding
ENV NODE_ENV=production
ENV BAKORIN_ENV=production
ENV BAKORIN_DATA_DIR=/data
EXPOSE 4371
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4371)+'/health').then(r=>process.exit(r.ok?0:1))"
CMD ["bun", "/bakorin/packages/server/src/cli.ts", "start", "--dir", "/project"]

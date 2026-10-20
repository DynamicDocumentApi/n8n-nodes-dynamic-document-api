# Changelog

## 0.1.1

- Published from GitHub Actions through npm trusted publishing (OIDC) instead of a stored token. No changes to the nodes.

## 0.1.0

- First release: the **Dynamic Document API** node (documents, images, PDF tools, e-invoices, batches, renders, templates, signed links, account) and the **Dynamic Document API Trigger** for webhook events.
- Template data from each template's schema (**Map Each Field**) or as JSON, files as binary data, waiting for slow renders, and use as an AI Agent tool.
- The trigger checks every delivery's signature, never makes its endpoint the workspace's default, and skips renders made in n8n unless asked.

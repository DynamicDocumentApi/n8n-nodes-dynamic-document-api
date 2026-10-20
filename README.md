# n8n nodes for Dynamic Document API

[Dynamic Document API](https://dynamicdocumentapi.com) renders PDFs, images and e-invoices from templates, HTML, web pages and Markdown. These community nodes bring it into [n8n](https://n8n.io): fill a template with data from any earlier node and pass the finished file on, for example to an email, a drive or a chat.

- **Dynamic Document API**: render documents and images, use the PDF tools, create e-invoices and batches, sign image URLs, and read renders, templates and usage. It also works as a tool for n8n's AI Agent.
- **Dynamic Document API Trigger**: start a workflow when a render succeeds or fails, a batch completes, a template is published, or another workspace event happens.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Usage](#usage) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

In a self-hosted n8n, go to **Settings** → **Community Nodes** → **Install** and enter:

```
@dynamic-document-api/n8n-nodes-dynamic-document-api
```

See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for other ways.

## Credentials

1. Sign up at [app.dynamicdocumentapi.com](https://app.dynamicdocumentapi.com/signup) (there is a free plan; no card needed).
2. Create an API key under **API keys** in the dashboard.
3. In n8n, create a **Dynamic Document API** credential with that key and your workspace's region.

The key decides the mode. A test key (`dda_test_…`) makes free test renders with a TEST watermark, which is the right choice while you build a workflow. A live key (`dda_live_…`) makes final renders that count against your plan.

## Operations

| Resource | Operations |
|---|---|
| Document (PDF) | Create from template, HTML, URL or Markdown |
| Image | Create from template, HTML or URL (screenshot) |
| PDF Tool | Merge, split, rotate, protect, unlock, get or update metadata, convert to PDF/A |
| E-Invoice | Create an XRechnung, EN 16931 or Factur-X / ZUGFeRD XML |
| Batch | Create, get, get items |
| Render | Get, get many, wait, delete files |
| Template | Get, get many, get schema |
| Signed Link | Sign a URL that renders an image or PDF when opened |
| Account | Get plan and renders left, get usage |

**Template data.** After you choose a template, **Map Each Field** lists its data fields from the template's schema; nested fields show as `Customer › Name`, line items as JSON. **Using JSON** sends the whole data object instead, for example an expression with the previous node's output.

**Files.** With **Download File** on, the rendered file arrives as binary data (`data`, then `data_2` … for more files), ready for an email attachment or an upload. The output also has a signed download link that stays valid for 24 hours.

**Slow renders.** A render step waits up to 25 seconds for the result on the server, then keeps asking until the render is done or **Max Wait** (default 120 seconds) has passed.

**PDF tools** take each input PDF from a binary field of an earlier node, a URL, or an earlier render.

## Trigger

Activating a workflow with the trigger creates a webhook endpoint in your workspace (listed under **Webhooks** in the dashboard as "n8n: *workflow name*"); deactivating it deletes the endpoint. Every delivery's signature is checked.

- **Your n8n must be reachable over https on port 443** (or 80, 8080, 8443): Dynamic Document API doesn't deliver to other ports. Set n8n's `WEBHOOK_URL` to the public address.
- **Listen for test event** asks Dynamic Document API to send a sample of the first selected event right away.
- **Renders made in n8n** are skipped by default, so a workflow that renders in its own steps can't start itself again and again.
- A workspace can have at most 20 webhook endpoints; each active workflow with the trigger uses one.

## Usage

- Map an order from your shop into an invoice template, render it, and attach the PDF to an email.
- Turn rows of a spreadsheet into certificates with **Batch → Create** and **One ZIP With Every File**.
- Let an AI Agent write a report and render it with **Document → Create From Markdown**.
- Start from the trigger's **Render Succeeded** to upload finished documents to a drive.

## Compatibility

Built with `@n8n/node-cli` 0.53 and tested with n8n 2.44.

## Resources

- [n8n integration guide](https://dynamicdocumentapi.com/docs/n8n)
- [API reference](https://dynamicdocumentapi.com/docs/api-reference)
- [Support](mailto:support@dynamicdocumentapi.com)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)

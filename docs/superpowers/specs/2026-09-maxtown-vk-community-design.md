# MaxTown VK Community Mini App — Product and Architecture Specification

**Status:** awaiting owner review  
**Date:** 2026-09-27  
**Supersedes:** the MAX platform assumption in the earlier MaxTown release design; the Render Free deployment target remains approved.

## Goal

Deliver MaxTown as a VK community bot with a VK Mini App for residents of an
apartment building. Residents can use a house-scoped community, create and vote
in anonymous informal polls, receive a VK message linking to a new poll, see
repair status, and read current information about services and providers
available in their particular house.

The product is a house community and information tool. Its polls do not replace
the legally established general-meeting procedure for property owners.

## Approved product decisions

- VK is the sole target platform. Replace MAX authentication, bridge, UI, and bot
  integrations; do not maintain two messaging-platform implementations.
- Keep the existing React/Vite, Fastify, PostgreSQL, house membership and role
  model, repair mode, registration/moderator workflow, and Render deployment
  approach unless implementation research identifies a concrete incompatibility.
- Any active resident of a house may create an informal poll with a question,
  multiple answer options, and an optional close time.
- Do not show the poll creator or individual ballot choices to residents, house
  roles, or the Moderator UI. Show aggregate counts only.
- A resident may submit at most one ballot per poll. Use a poll-scoped opaque
  nullifier rather than storing `membership_id` beside the selected option.
  The application service still has the secret and resident identity needed to
  derive a nullifier, so this is anonymity from house participants and staff,
  not a cryptographic guarantee against the service operator.
- On poll creation, notify active members of that same house who enabled
  messages from the VK community. The message contains a deep link to the poll.
  Residents who have not enabled messages can still see the poll in the in-app
  community feed; the product must not claim that VK permits delivery to them.
- Each house has its own manually maintained service directory. Residents can
  read it; the Headman and Responsible roles can create, update, and deactivate
  entries.
- Display the information source and last-checked date for service and tariff
  data. Do not imply automatic provider integration in the first release.
- There is no deployed Render database at the time of this specification. Do
  not reinterpret a MAX user ID as a VK user ID. Existing house-domain data
  should be preserved by migrations; resident identities must be established
  through VK. If a production database is discovered, stop and prepare an
  explicit account-linking/migration path before changing identity data.

## Architecture

### VK Mini App and authentication

The resident client uses React/Vite, VKUI and VK Bridge. Initialize the bridge,
read VK launch parameters, and send the original parameters to the API. The API
validates the VK signature using the Mini App secret, checks the configured
application ID, and only then accepts the signed VK user ID. Do not use a
client-supplied user ID, a parsed-but-unverified launch parameter, or a user
access token as a substitute for the signature check. After verification, keep
the existing server-issued, hashed bearer-session model for subsequent API
requests.

Replace MAX-specific resident identity storage with an explicit VK identity
field or identity relation. House memberships continue to reference the stable
internal resident ID, not a platform ID. Expire/revoke existing sessions during
the platform transition. No automatic MAX-to-VK identity matching is allowed.

### Community bot, in-app house community, and notifications

The existing database-backed house community remains the source of messages
shown inside the Mini App; it is scoped to one house and must not expose another
house's content. The VK community bot is the external entry point and delivery
channel. The API uses a server-held VK community token to send messages; the
token and Mini App secret are never sent to the client or committed to Git.

Onboarding offers the VK permission to receive messages from the community.
Store the permission state and consent time per resident. Provide a way to
re-enable notifications after revocation. A poll notification is addressed to
each eligible active membership in the poll's house only. The deep link opens
that poll in the Mini App.

Insert a database outbox record in the same transaction that creates a poll.
An in-process sender delivers pending messages, records delivery/failure state,
uses idempotency keys, retries transient API failures with bounded backoff, and
marks permanent permission failures as undeliverable. Resume pending messages
after service startup. On Render Free, a sleeping process cannot guarantee a
delivery deadline; report this as best-effort delivery and retain the poll in
the in-app feed.

### Anonymous informal polls

- Restrict all poll reads, writes, votes, and results to active members of the
  requested house.
- Validate bounded question/option lengths, require at least two distinct
  options, and support optional close time.
- Keep creator identity out of resident-facing API responses and the Moderator
  UI. Store only the minimum creator reference required for internal abuse
  prevention/audit; never attach that value to notification text or public poll
  links.
- Authenticate the voter and verify current house membership before accepting
  a ballot. Derive a per-poll keyed nullifier from the internal membership ID;
  persist only the poll, selected option, and nullifier. Enforce a unique
  `(poll_id, nullifier)` constraint transactionally.
- Never provide a per-voter ballot query or a list of voters. Results aggregate
  ballots by option. The voter may see their own selected option, but no one
  sees who selected any option.
- Lock closed polls against new votes. Keep polls labelled as informal and
  non-binding.
- Do not log VK IDs, membership IDs, nullifiers, or option selections together.

The keyed nullifier limits direct database linkage but is not a cryptographic
secret-ballot scheme: an operator who has both application secrets and identity
data can derive the mapping. If product requirements later demand anonymity
from the service operator, that must be a separate security design using a
reviewed cryptographic voting protocol; do not improvise one inside this MVP.

### House service and provider directory

Each service record belongs to a house and contains:

- service category and short description;
- provider name and optional provider reference/URL;
- current state (`available`, `limited`, `unavailable`, `under_repair`, or
  `unknown`);
- one or more tariffs with title, amount, currency, billing period, conditions,
  and optional validity dates;
- contact phone, URL, and free-text contact instructions where provided;
- source URL or source description, last-checked time, and last-updating
  membership.

Residents can read active records for their house. The Headman and Responsible
roles can add, edit, and deactivate records only in houses where they hold the
corresponding active membership. Show stale/missing verification dates and
unknown states explicitly instead of presenting unverified values as current.
No scraping, external provider API, tariff comparison, payment, or service
contracting is included in this release.

The service directory is distinct from the existing “nearby places” directory:
it describes a service supplied to a particular house, not a local business
that happens to be nearby.

### Deployment and secrets

Keep the approved Render Free Blueprint and GitHub Actions release gate. Update
the service configuration and deployment documentation for VK. The service
requires secrets/configuration for the VK Mini App ID, Mini App secret, VK
community ID/token, VK Callback API confirmation/secret values if Callback API
is used, Moderator credentials, and the public Mini App URL. Use Render secret
environment fields; no secret goes in `render.yaml`, GitHub Actions, or source
control.

The API/web process remains the deployable unit unless verified VK platform
requirements require a separate endpoint. The VK bot and notification sender
must not require a second always-on free worker. Any Callback API route validates
its configured confirmation and secret values before accepting events.

## Failure and privacy behavior

- Invalid, stale, wrong-app, or tampered VK launch data receives `401`; it must
  never create a resident session.
- VK message permission missing/revoked is a delivery state, not a poll-creation
  failure. The poll remains available in the house feed.
- Transient VK API errors retry from the outbox without duplicating successful
  notifications; permanent errors are visible to authorized operational logs
  without exposing ballot data.
- Cross-house access returns a denial without disclosing whether the referenced
  poll or service exists in another house.
- The Mini App never shows creator identity or a list connecting identities to
  votes. Aggregate results are the only shared vote output.
- The service directory labels source and freshness, and treats unverified
  prices/statuses as stale or unknown.
- Render Free sleep and database-expiration limitations remain documented. A
  passing local/CI smoke is not evidence that VK credentials or the hosted VK
  bot work.

## Acceptance criteria

### Platform and authentication

1. The resident UI initializes in VK clients using VKUI/VK Bridge and builds
   without MAX-only runtime dependencies.
2. Valid signed launch parameters for the configured VK app create a session;
   tampered parameters, wrong app IDs, stale parameters, missing signatures,
   and spoofed user IDs do not.
3. Session expiry/revocation and logout continue to work; protected APIs require
   a valid server session.

### Community, polls, and notifications

4. House members can read and write only their own house community.
5. An active member can create a poll with multiple distinct choices and an
   optional future close time; invalid polls are rejected.
6. A member can vote once. Parallel duplicate submissions yield exactly one
   accepted ballot; results expose counts only.
7. Poll creator identity and individual voter identity/choice are absent from
   resident-facing API responses, notifications, and Moderator UI.
8. Creating a poll produces one outbox job per eligible active member of that
   house. Each successful delivery includes a link to the poll. Members of
   another house and users without messaging permission receive no DM.
9. Retried outbox jobs do not produce duplicate successful sends; denied
   permission and permanent delivery failures are represented accurately.

### House services

10. Authorized roles can add, update, and deactivate their house's service,
    provider, tariff, state, contact, source, and verification metadata.
11. Residents can read active service records for their house only. They cannot
    edit them or inspect records belonging to another house.
12. Missing/stale source checks and unknown service state are clear in the UI.

### Release

13. CI covers database migrations, full tests, typecheck, VK UI build, API image,
    and clean Compose smoke without platform secrets.
14. After the account owner configures VK/Render secrets and applies the
    Blueprint, the hosted smoke verifies health/readiness, invalid VK
    authentication rejection, valid test-user sign-in, house access boundaries,
    poll creation/voting, notification permission/delivery, and service reads.
15. Do not call the task fully deployed until the hosted smoke passes; report
    VK permission failures and Render Free sleep/data-retention limits honestly.

## Out of scope

- Maintaining MAX alongside VK.
- Legally binding owner votes, quorum calculation, electronic signatures, or
  claims that informal poll results constitute an official decision.
- Cryptographic anonymity from the service operator.
- Automatic provider integrations or scraping and tariff purchases.
- Guaranteed delivery of VK private messages to users who have not allowed
  messages from the community.
- A second always-on Render worker/service on the Free plan.

## Platform references

- [VK Mini App launch parameter signature](https://dev.vk.com/ru/mini-apps/development/launch-params-sign)
- [VK Bridge source and supported method names](https://github.com/VKCOM/vk-bridge/blob/master/packages/core/src/bridge.ts)
- [VK community messages API schema](https://github.com/VKCOM/api-schema-typescript/blob/master/src/methods/messages.ts)
- [VKUI integration guide for VK Mini Apps](https://github.com/VKCOM/VKUI/blob/master/website/content/integrations/vk-mini-apps.mdx)
- [Render Free deployment guide](../../deployment.md)

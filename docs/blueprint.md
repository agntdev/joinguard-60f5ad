# GroupGuard Moderation Bot — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Automated moderation bot for Telegram groups with verification, spam detection, admin tools, and moderation logs. Restricts new members until verified, enforces rules via configurable thresholds, and provides audit trails for moderation actions.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Telegram group administrators

## Success criteria

- Automated verification of new members
- Spam detection with configurable thresholds
- Admin-visible moderation logs
- Configurable welcome messages and rules
- Progressive moderation actions (warn/mute/remove)

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open admin configuration menu for group owners
- **Verify** (button, actor: user, callback: verify:start) — Initiates verification flow for new members
- **/verify** (command, actor: admin, command: /verify) — Admin command to manually verify users
- **/spam** (command, actor: admin, command: /spam) — Admin command to check spam thresholds
- **/summary** (command, actor: admin, command: /summary) — Request moderation summary report

## Flows

### Join verification
_Trigger:_ new_member_joined

1. Send welcome message with verification code
2. Restrict posting permissions
3. Wait for verification input
4. Verify code or auto-remove

_Data touched:_ Member, VerificationToken

### Spam detection
_Trigger:_ message_posted

1. Check message against spam rules
2. Apply configured moderation action
3. Log action to moderation log
4. Notify admin if configured

_Data touched:_ Member, ModerationLog

### Admin moderation
_Trigger:_ /moderation command

1. Parse admin command
2. Apply action (warn/mute/kick/ban)
3. Update moderation log
4. Confirm action to admin

_Data touched:_ ModerationLog, RuleSet

### Summary report
_Trigger:_ /summary

1. Aggregate join/verify/remove stats
2. Format report with thresholds
3. Send summary to admin

_Data touched:_ ModerationLog

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Member** _(retention: persistent)_ — Telegram user with verification status and moderation history
  - fields: user_id, join_time, verified, post_restrictions, spam_score
- **VerificationToken** _(retention: session)_ — Time-limited code for new member verification
  - fields: code_value, expiry_time, attempts_remaining
- **RuleSet** _(retention: persistent)_ — Configurable moderation rules and thresholds
  - fields: welcome_message, rules_text, verification_timeout, spam_thresholds, action_sequence
- **TrustList** _(retention: persistent)_ — Users exempt from automated moderation
  - fields: user_id, trusted_status
- **ModerationLog** _(retention: persistent)_ — Record of automated and manual moderation actions
  - fields: action_type, actor_id, target_id, timestamp, reason

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure welcome message and rules text
- Set verification timeout (default 5min)
- Adjust spam thresholds (age=48h, repeats=3, flood=5/10s)
- Set action sequence (warn→mute→remove)
- Manage trusted users list
- Enable/disable private admin notifications

## Notifications

- In-group admin alerts for moderation actions
- Private admin notifications (configurable)

## Permissions & privacy

- Stores member verification status
- Tracks spam scores and moderation history
- Logs moderation actions with timestamps

## Edge cases

- Verification code timeout handling
- Spam detection false positives
- Admin command input validation
- Message rate limiting during verification

## Required tests

- End-to-end verification flow with timeout
- Spam detection accuracy with edge cases
- Admin command permissions and responses
- Moderation log persistence

## Assumptions

- Admin will configure initial rules
- Group has at least one admin with bot permissions
- Moderation actions don't violate Telegram's ToS

<!-- EDIT BY NADA — frontend handoff for the existing SMS/WhatsApp recipient picker. -->
# SMS / WhatsApp unit picker

The frontend is prepared independently of Wialon credentials. It requests `GET /api/sms/units` on the same application origin using the existing authenticated session. The token is handled by the backend integration, not entered into the picker or returned in its payload. No new backend configuration is required for preparing this frontend.

The existing route in `routes/sms.js` uses `getUnitsForUser(sessionUser)` and exposes these mapped Wialon fields:

| Unit field | Purpose |
| --- | --- |
| `id` | Stable Wialon unit ID for selection and refresh reconciliation |
| `name` | Unit display name |
| `deviceType` | Device model from the existing Wialon hardware mapping |
| `accountGroup` | Account display name and search |
| `mobileNumber` | SIM recipient number; never infer a missing value |
| `serialNumber` | Existing device identifier/IMEI field for search |
| `status` | Existing mapped connection status |

A successful payload contains `success: true`, `units: [...]`, and optionally `source: 'wialon'`, `integrationAvailable: true`. An empty successful array means no units are available to this account. An explicit `integrationAvailable: false` produces the prepared waiting state with no unit rows. Failures use `success: false` and a user-facing `error`; expired sessions remain authentication errors. The frontend does not replace failures with demo units.

The prepared UI includes loading, awaiting connection, successful empty results, search with no matches, missing SIM, connected results and retry/error states. Searches include device type; multiple selections retain current backend SIM values after refresh. Switching to saved Contacts remains independent of Wialon connection availability.

<!-- EDIT BY NADA — explicit unit staging supports bulk offline selection without changing the API. -->
Unit selection uses two boxes: Available units on the left and Selected units on the right. Search and the All statuses / Offline / Online filter apply to available units. Checking rows only stages them, preserving marks across searches; Select all shown can mark an entire offline result set. Move commits marked units to the right without duplicates. Remove returns marked selected units to the left; Clear all clears only unit recipients. Both boxes scroll independently and stack on mobile. Only units committed to the right enter the existing send payload. Contact and manual-number recipients remain independent. No API, authentication, provider or Wialon changes are needed for this interaction.

<!-- EDIT BY NADA — the compact composer retains the same integration contract. -->
The isolated Preview intentionally stays in the awaiting-connection state and displays one compact waiting row, without fabricated units. Backend credentials do not connect that static Preview to production. Live verification must use the connected Observer application after its existing Wialon setup and session are ready.

Verification: `node --test preview/tests/sms-wialon-picker.test.mjs`. These tests use isolated Wialon/provider substitutes and disposable browsers. No production token, real unit or real message is used.

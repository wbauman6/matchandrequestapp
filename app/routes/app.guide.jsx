import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useLoaderData } from "react-router";

/**
 * Staff guide.
 *
 * Written for salespeople who are not tech-savvy and are reading this between
 * customers. Rules followed deliberately:
 *   - Task-oriented ("a customer wants something you don't have"), not
 *     feature-oriented ("the Requests module").
 *   - No scores, percentages or model names. Staff never need them, and a
 *     number on screen invites arguing with it instead of using judgement.
 *   - Every section answers "what do I actually do", not "what this is".
 *   - Printable: a one-off read on a computer beats a help screen nobody
 *     opens on a busy floor.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // Shown so the guide reflects how THIS store is actually staffed rather than
  // describing a default. Deliberately does NOT read a drop-day setting: this
  // store's ShopConfig has no such column (that lives in the multi-tenant
  // build), and referencing it here would throw on load.
  const salespeople = await prisma.salesperson
    .count({ where: { shop: session.shop, active: true, inRotation: true } })
    .catch(() => 0);
  return { salespeople };
};

export default function GuidePage() {
  const { salespeople } = useLoaderData();

  return (
    <s-page heading="How to use this">
      <s-section heading="What this does">
        <P>
          A customer asks for something the shop doesn&apos;t have today. Instead of a
          note on paper that gets lost, you put it in here. When a piece comes in that
          fits, the app tells you — so you can call them before someone else does.
        </P>
        <P>
          You do not have to describe things perfectly. Write it the way you&apos;d say
          it. <Q>14k wg dia studs martini</Q> works fine.
        </P>
      </s-section>

      <s-section heading="Taking a request at the counter">
        <Step n="1" t="Open the app on the iPad and tap New request." />
        <Step n="2" t="Find the customer, or type their name and phone if they're new." />
        <Step
          n="3"
          t="Write what they want. Include metal, stone, size and roughly what they want to spend if they said."
        />
        <Step n="4" t="Save. That's it — the app starts looking straight away." />
        <P style={{ marginTop: 14 }}>
          <B>One request = one piece.</B> If someone wants a ring <em>and</em> a bracelet,
          make two requests. The app looks for one item at a time, so a combined request
          finds nothing useful.
        </P>
        <P>
          Numbers like <Q>5 to 7 ct</Q> or <Q>3 stone</Q> are fine — the app knows those
          describe the piece, not how many they want.
        </P>
      </s-section>

      <s-section heading="Write it so it can actually be matched">
        <P>
          The app can only find what you describe. <Q>2 cool rings</Q> and{" "}
          <Q>something nice for my wife</Q> will never match anything, because they
          don&apos;t say what the piece is.
        </P>
        <Two
          good={[
            "14k yellow gold estate diamond cross",
            "Platinum solitaire, around 1 carat, under $6,000",
            "Mens white gold star sapphire ring",
            "Estate diamond studs about half a carat total",
          ]}
          bad={["2 cool rings", "stunning earrings", "a gift", "something sparkly"]}
        />
        <P style={{ marginTop: 14 }}>
          If a customer is vague, ask two questions: <B>what metal</B> and{" "}
          <B>what stone</B>. That&apos;s usually enough.
        </P>
      </s-section>

      <s-section heading="Requests that came from the website">
        <P>
          These show an orange <Tag tone="warn">Call customer</Tag> tag. Nobody has
          spoken to this person yet — they filled in a form. They are often vague,
          because a customer wrote them, not you.
        </P>
        <P>
          <B>Call them, then tap &ldquo;I called them.&rdquo;</B> The tag turns green and
          says <Tag tone="ok">Called</Tag>, so nobody rings the same person twice and
          nobody assumes someone else already did.
        </P>
        <P>
          While you have them on the phone, fix the wording of the request to what they
          actually want. That is the single most useful thing you can do — a vague
          request that nobody rewrites will never match anything.
        </P>
      </s-section>

      <s-section heading="When the app finds something">
        <P>
          You&apos;ll see the request move into <B>New matches</B>. Open it and look at
          the pieces it found.
        </P>
        <Bullet>If one is right, call the customer.</Bullet>
        <Bullet>
          If a piece is wrong, decline it. That teaches the app and stops it showing you
          the same wrong thing again.
        </Bullet>
        <Bullet>
          Declining is not rude and nothing is lost — it only affects what you get shown.
        </Bullet>
      </s-section>

      <s-section heading="When it finds nothing">
        <P>
          That is normal, especially for unusual pieces. The request stays open and the
          app keeps checking as new stock arrives. You do not need to do anything or
          re-enter it.
        </P>
        <P>
          If a request has sat a long time with nothing found, it is worth re-reading.
          Often the wording is too narrow, or it is really two pieces in one.
        </P>
      </s-section>

      <s-section heading="After the sale">
        <P>
          Tap <B>Fulfill</B> when they buy. It leaves your working list but is not
          deleted — it moves to <B>Sold</B>, so you can still look up what someone bought
          last time.
        </P>
        <P>
          Use <B>Archive</B> if they&apos;ve lost interest or bought elsewhere. Same
          thing: hidden, not gone.
        </P>
      </s-section>

      <s-section heading="Questions people ask">
        <QA q="Do I have to check this every day?">
          No. You get an email with your own requests when there&apos;s something to look
          at. Checking the iPad when you have a quiet minute is enough.
        </QA>
        <QA q="Someone asked a question instead of asking for a piece. What do I do?">
          Nothing. Questions, repairs and &ldquo;do you buy gold&rdquo; messages go to the
          office, not to you. They never land in your list.
        </QA>
        <QA q="I made a request for the wrong customer.">
          Open it and fix it, or archive it. Nothing here is permanent.
        </QA>
        <QA q="Why did it show me something that costs more than their budget?">
          Budget is a guide, not a wall. If a piece is right but a bit over, you still get
          to decide whether to mention it.
        </QA>
        <QA q="Will another salesperson take my customer?">
          No. Website requests are shared out evenly
          {salespeople > 0 ? <> between the {salespeople} people in the rotation</> : null},
          and a request you take at the counter stays yours.
        </QA>
      </s-section>

      <s-section heading="For whoever runs the shop">
        <P>
          <B>Settings</B> controls who is in the rotation, which days alert emails go out,
          how fussy matching should be, and when new stock is checked.
        </P>
        <P>
          <B>Appraiser</B> lists requests for pieces with no designer name, with the
          ones nothing was found for at the top — the demand worth appraising against
          first.
        </P>
        <P>
          The <B>Problems</B> filter on the Requests page shows anything that failed to
          run. It is normally empty; if it isn&apos;t, something needs attention.
        </P>
      </s-section>
    </s-page>
  );
}

function P({ children, style }) {
  return (
    <p style={{ fontSize: 14, lineHeight: 1.65, color: "#303336", margin: "0 0 10px", ...style }}>
      {children}
    </p>
  );
}

function B({ children }) {
  return <strong style={{ color: "#202223" }}>{children}</strong>;
}

function Q({ children }) {
  return (
    <span style={{ fontStyle: "italic", color: "#5c5f62" }}>&ldquo;{children}&rdquo;</span>
  );
}

function Step({ n, t }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
      <div
        style={{
          flex: "0 0 24px",
          height: 24,
          borderRadius: 12,
          background: "#f1f8ff",
          color: "#005bd3",
          fontWeight: 700,
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {n}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, paddingTop: 2 }}>{t}</div>
    </div>
  );
}

function Bullet({ children }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
      <div style={{ color: "#8c9196" }}>&bull;</div>
      <div style={{ fontSize: 14, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Tag({ tone, children }) {
  const warn = tone === "warn";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        padding: "2px 8px",
        borderRadius: 10,
        background: warn ? "#fff5ea" : "#e3f1df",
        color: warn ? "#a85100" : "#1a7a4a",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Two({ good, bad }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
      <Col title="Works" tone="ok" items={good} />
      <Col title="Won't match anything" tone="warn" items={bad} />
    </div>
  );
}

function Col({ title, tone, items }) {
  const ok = tone === "ok";
  return (
    <div
      style={{
        flex: "1 1 240px",
        border: `1px solid ${ok ? "#b7e0c4" : "#f0d0ae"}`,
        background: ok ? "#f6fbf7" : "#fffaf3",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: ok ? "#1a7a4a" : "#a85100",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {items.map((i) => (
        <div key={i} style={{ fontSize: 13, lineHeight: 1.6, color: "#303336" }}>
          {i}
        </div>
      ))}
    </div>
  );
}

function QA({ q, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginBottom: 3 }}>{q}</div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#5c5f62" }}>{children}</div>
    </div>
  );
}

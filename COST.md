# MedMate — Will It Cost You?

Short answer: **you can build and demo MedMate at little or no cost** if you use free tiers and hackathon credits. You only pay if you go beyond those.

---

## 1. Hackathon GCP credits (use these first)

The [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) offers **GCP credits** that cover most services you need: **Vertex AI, Cloud Run**, etc.

- **Request credits:** [Form link](https://forms.gle/rKNPXA1o6XADvQGb7) (request by **Mar 13, 12:00 PM PT** if needed — see [PROJECT_BRIEF.md](./PROJECT_BRIEF.md)).
- **Tip:** Develop and test locally as much as possible so credits last through the **judging period** and demo.

Using hackathon credits means **Vertex AI (Gemini Live)** and **Cloud Run** usage during the contest can be **$0 out of pocket**.

---

## 2. Google Cloud free trial (if you’re new to GCP)

If you’re eligible for the [Google Cloud Free Trial](https://cloud.google.com/free):

- **$300 in credits** for 90 days.
- No charge unless you turn the account into a paid one.
- Covers Vertex AI, Cloud Run, Firestore, etc.

So even without hackathon credits, a **new** GCP account can run MedMate for the hackathon period **without paying**, as long as you stay within the trial.

---

## 3. Always-free / free tier (no expiry)

Some services have **permanent free tiers** that don’t depend on credits:

| Service     | Free tier (typical) | Enough for MedMate? |
|------------|----------------------|----------------------|
| **Firestore** | 50K reads / 20K writes per day, 1 GB storage | ✅ Yes (few elders, few reads/writes per session). |
| **Cloud Run** | 2 million requests/month (within free tier limits) | ✅ Yes for demo and light use. |

So **Firestore** and a lot of **Cloud Run** usage can be **$0** even after credits or trial end, if usage stays low.

---

## 4. What actually costs money (if you exceed free)

- **Vertex AI / Gemini Live API** — Charged by usage (e.g. tokens, audio). This is where most cost can come from if you use it a lot **after** credits/trial.
- **Cloud Run** — Only if you exceed the free tier (e.g. many requests or a lot of CPU/memory).
- **Firestore** — Only if you exceed 50K reads / 20K writes per day, etc.

For a **hackathon build + demo + judging**, staying within:
- hackathon GCP credits, or  
- GCP free trial $300, and  
- free tiers for Firestore/Cloud Run  

means **it does not have to cost you anything**.

---

## 5. Practical summary

| Situation | Cost to you |
|-----------|-------------|
| You **request hackathon credits** and use them for Vertex AI + Cloud Run | **$0** (credits cover it). |
| You use a **new GCP account** ($300 trial) and stay within it | **$0** for 90 days. |
| You stay within **Firestore / Cloud Run free tiers** | **$0** for those services. |
| You **run MedMate heavily after the hackathon** (no credits left) | You pay for Vertex AI (and any extra Cloud Run) by usage. |

**Bottom line:** For the idea and tech stack you have, **it does not need to cost you anything** for the hackathon if you use hackathon credits and/or the GCP free trial and free tiers. Request credits by the deadline and develop locally when you can to keep costs at zero.

---

*Pricing and free tiers can change; check [Google Cloud Pricing](https://cloud.google.com/pricing) and [Free Trial](https://cloud.google.com/free) for current details.*

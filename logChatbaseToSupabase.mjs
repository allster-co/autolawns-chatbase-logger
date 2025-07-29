import { createClient } from '@supabase/supabase-js'
import axios from 'axios'

// ✅ Read secrets from GitHub Actions env (do not use dotenv in Actions)
const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY
const CHATBASE_BOT_ID = process.env.CHATBASE_BOT_ID
const CHATBASE_API_URL = "https://www.chatbase.co/api/v1/get-conversations"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ✅ Init Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ✅ Debug: Confirm env variables are loaded
console.log(`[DEBUG] CHATBASE_BOT_ID from env: ${CHATBASE_BOT_ID}`)
console.log(`[DEBUG] SUPABASE_URL from env: ${SUPABASE_URL?.slice(0, 30)}...`)

const getConversations = async () => {
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const startISO = oneHourAgo.toISOString()
  const endISO = now.toISOString()

  console.log(`[INFO] Fetching conversations from Chatbase`)
  console.log(`[INFO] Time window: ${startISO} → ${endISO}`)
  console.log(`[INFO] Bot ID: ${CHATBASE_BOT_ID}`)

  try {
    const response = await axios.get(CHATBASE_API_URL, {
      headers: {
        Authorization: `Bearer ${CHATBASE_API_KEY}`
      },
params: {
  chatbotId: CHATBASE_BOT_ID,
  startDate: startISO,
  endDate: endISO,
  page: 1,
  size: 50 // or whatever you want to limit to
}

    })

    if (!Array.isArray(response.data)) {
      console.error(`[ERROR] Unexpected response from Chatbase`, response.data)
      return []
    }

    console.log(`[INFO] Retrieved ${response.data.length} conversations`)
    return response.data
  } catch (error) {
    console.error(`[ERROR] Chatbase request failed`)
    if (error.response) {
      console.error(`[ERROR] Status: ${error.response.status}`)
      console.error(`[ERROR] Data:`, error.response.data)
    } else {
      console.error(`[ERROR]`, error.message)
    }
    return []
  }
}

const summarize = (messages) =>
  messages.map((m) => m.content).join(' ').slice(0, 400)

const run = async () => {
  const conversations = await getConversations()

  for (const convo of conversations) {
    const email = convo.metadata?.email
    const messages = convo.messages

    if (!email || !messages?.length) {
      console.log(`[SKIP] Conversation missing email or messages`)
      continue
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    const { data: lead } = !customer
      ? await supabase.from('leads').select('id').eq('email', email).maybeSingle()
      : { data: null }

    if (!customer && !lead) {
      console.log(`[SKIP] Email not found in customers or leads: ${email}`)
      continue
    }

    const summary = summarize(messages)

    const { error } = await supabase.from('interaction_logs').insert({
      customer_id: customer?.id ?? null,
      lead_id: lead?.id ?? null,
      interaction_type: 'chatbase_summary',
      summary,
      created_at: new Date().toISOString()
    })

    if (error) {
      console.error(`[ERROR] Failed to insert interaction log for ${email}`, error)
    } else {
      console.log(`[✅] Logged interaction for ${email}`)
    }
  }

  console.log(`✅ Finished processing ${conversations.length} conversations`)
}

run().catch(console.error)

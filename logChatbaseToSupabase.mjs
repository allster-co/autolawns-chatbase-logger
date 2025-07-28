// logChatbaseToSupabase.mjs

import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY
const CHATBASE_API_URL = "https://www.chatbase.co/api/v1/get-conversations"
const CHATBASE_BOT_ID = process.env.CHATBASE_BOT_ID

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
        bot_id: CHATBASE_BOT_ID,
        start_date: startISO,
        end_date: endISO
      }
    })

    if (!Array.isArray(response.data)) {
      console.error(`[ERROR] Unexpected response:`, response.data)
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

    if (!email || !messages?.length) continue

    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    const { data: lead } = !customer
      ? await supabase.from('leads').select('id').eq('email', email).maybeSingle()
      : { data: null }

    if (!customer && !lead) continue

    await supabase.from('interaction_logs').insert({
      customer_id: customer?.id ?? null,
      lead_id: lead?.id ?? null,
      interaction_type: 'chatbase_summary',
      summary: summarize(messages),
      created_at: new Date().toISOString()
    })
  }

  console.log(`✅ Processed ${conversations.length} conversations.`)
}

run().catch(console.error)

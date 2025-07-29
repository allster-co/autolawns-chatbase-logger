import { createClient } from '@supabase/supabase-js'
import axios from 'axios'

// ✅ Secrets from GitHub Actions env
const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY
const CHATBASE_BOT_ID = process.env.CHATBASE_BOT_ID
const CHATBASE_API_URL = "https://www.chatbase.co/api/v1/get-conversations"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ✅ Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ✅ Debug logs
console.log(`[DEBUG] CHATBASE_BOT_ID from env: ${CHATBASE_BOT_ID}`)
console.log(`[DEBUG] SUPABASE_URL from env: ${SUPABASE_URL?.slice(0, 30)}...`)

const getConversations = async () => {
  const today = new Date()
  const dateOnly = today.toISOString().split('T')[0]

  console.log(`[INFO] Fetching conversations from Chatbase`)
  console.log(`[INFO] Date: ${dateOnly}`)
  console.log(`[INFO] Bot ID: ${CHATBASE_BOT_ID}`)

  try {
    const response = await axios.get(CHATBASE_API_URL, {
      headers: {
        Authorization: `Bearer ${CHATBASE_API_KEY}`,
        accept: 'application/json',
      },
      params: {
        chatbotId: CHATBASE_BOT_ID,
        startDate: dateOnly,
        endDate: dateOnly,
        page: 1,
        size: 50
      }
    })

    const chats = response.data?.data
    if (!Array.isArray(chats)) {
      console.error(`[ERROR] Unexpected response from Chatbase`, response.data)
      return []
    }

    console.log(`[INFO] Retrieved ${chats.length} conversations`)
    return chats
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

const summarize = (messages) => {
  const contentList = messages
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)
  return contentList.join(' ').slice(0, 400)
}

const extractEmailFromMessages = (messages) => {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''
    const match = content.match(emailRegex)
    if (match) return match[0]
  }
  return null
}

const run = async () => {
  const conversations = await getConversations()

  for (const convo of conversations) {
    try {
      const messages = convo.messages
      if (!messages?.length) {
        console.log(`[SKIP] Conversation missing messages`)
        continue
      }

      // ✅ Deduplication check
      const { data: existing } = await supabase
        .from('interaction_logs')
        .select('id')
        .eq('chatbase_conversation_id', convo.id)
        .maybeSingle()

      if (existing) {
        console.log(`[SKIP] Already logged conversation ${convo.id}`)
        continue
      }

      // ✅ Email extraction
      let email = convo.metadata?.email
      if (!email) {
        email = extractEmailFromMessages(messages)
        if (email) {
          console.log(`[INFO] Extracted email from message: ${email}`)
        }
      }

      if (!email) {
        console.log(`[SKIP] No email found in metadata or messages`)
        continue
      }

      // ✅ Lookup customer or lead
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

      // ✅ Insert new interaction log
      const { error } = await supabase.from('interaction_logs').insert({
        customer_id: customer?.id ?? null,
        lead_id: lead?.id ?? null,
        interaction_type: 'chatbot',
        summary,
        created_at: new Date().toISOString(),
        chatbase_conversation_id: convo.id
      })

      if (error) {
        console.error(`[ERROR] Failed to insert interaction log for ${email}`, error)
      } else {
        console.log(`[✅] Logged interaction for ${email}`)
      }
    } catch (err) {
      console.error(`[ERROR] Failed processing one conversation`, err)
    }
  }

  console.log(`✅ Finished processing ${conversations.length} conversations`)
}

run().catch(console.error)

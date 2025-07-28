import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY!
const CHATBASE_API_URL = "https://api.chatbase.com/api/v1/conversations"

const getConversations = async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const response = await axios.get(CHATBASE_API_URL, {
    headers: {
      Authorization: `Bearer ${CHATBASE_API_KEY}`
    },
    params: {
      start_date: oneHourAgo
    }
  })
  return response.data.conversations
}

const summarize = (messages: any[]) =>
  messages.map((m: any) => m.content).join(' ').slice(0, 400)

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

    const { data: lead } = !customer ? await supabase
      .from('leads')
      .select('id')
      .eq('email', email)
      .maybeSingle() : { data: null }

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

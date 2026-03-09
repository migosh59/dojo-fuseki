import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://oimidjxvheebxeyspcrw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_1KT7e01fdf7ItXjTGAdFnw_91WFwb9Q'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

/* ─── Auth ─────────────────────────────────── */
export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    return session
}

export async function getUser() {
    const session = await getSession()
    return session?.user ?? null
}

/* ─── SGF Files ─────────────────────────────── */
export async function listerSgf() {
    const user = await getUser()
    if (!user) return []
    const { data, error } = await supabase
        .from('sgf_files')
        .select('*')
        .order('updated_at', { ascending: false })
    if (error) { console.error(error); return [] }
    return data
}

export async function uploaderSgf(file) {
    const user = await getUser()
    if (!user) return null

    const path = `${user.id}/${file.name}`

    // Upload dans Storage
    const { error: storageError } = await supabase.storage
        .from('sgf-files')
        .upload(path, file, { upsert: true })
    if (storageError) { console.error(storageError); return null }

    // Vérifier si un SGF avec ce nom existe déjà
    const { data: existing } = await supabase
        .from('sgf_files')
        .select('id')
        .eq('owner_id', user.id)
        .eq('name', file.name)
        .single()

    let sgfId
    if (existing) {
        // Mettre à jour
        const { data } = await supabase
            .from('sgf_files')
            .update({ updated_at: new Date().toISOString(), storage_path: path })
            .eq('id', existing.id)
            .select()
            .single()
        sgfId = data.id
    } else {
        // Créer
        const { data, error } = await supabase
            .from('sgf_files')
            .insert({ owner_id: user.id, name: file.name, storage_path: path })
            .select()
            .single()
        if (error) { console.error(error); return null }
        sgfId = data.id
    }
    return sgfId
}

export async function telechargerSgf(storagePath) {
    const { data, error } = await supabase.storage
        .from('sgf-files')
        .download(storagePath)
    if (error) { console.error(error); return null }
    return await data.text()
}

export async function supprimerSgf(sgfId, storagePath) {
    await supabase.storage.from('sgf-files').remove([storagePath])
    await supabase.from('sgf_files').delete().eq('id', sgfId)
}

/* ─── Progression ───────────────────────────── */
export async function chargerProgression(sgfId) {
    const user = await getUser()
    if (!user) return {}
    const { data, error } = await supabase
        .from('variation_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('sgf_id', sgfId)
    if (error) { console.error(error); return {} }
    const result = {}
    for (const row of data) {
        result[row.variation_sig] = {
            statut: row.status,
            nom: row.custom_name,
            commentaire: row.comment
        }
    }
    return result
}

export async function sauvegarderVariation(sgfId, sig, statut, nom, commentaire) {
    const user = await getUser()
    if (!user) return
    await supabase.from('variation_progress').upsert({
        user_id: user.id,
        sgf_id: sgfId,
        variation_sig: sig,
        status: statut,
        custom_name: nom,
        comment: commentaire ?? '',
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,sgf_id,variation_sig' })
}
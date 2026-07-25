import sys
import json
import UnityPy
from pathlib import Path

BUNDLE_BASE_KEY = "532b4631e4a7b9473e7cfb"

def _create_final_key(bundle_key_int: int):
    base_key = bytes.fromhex(BUNDLE_BASE_KEY)
    bundle_key_bytes = bundle_key_int.to_bytes(8, byteorder="little", signed=True)
    base_len = len(base_key)
    final_key = bytearray(base_len * 8)
    for i, b in enumerate(base_key):
        baseOffset = i * 8
        for j, k in enumerate(bundle_key_bytes):
            final_key[baseOffset + j] = b ^ k
    return final_key

def _load_env_from_path(asset_path, params):
    use_decryption = params.get('use_decryption', False)
    if use_decryption:
        query_result = handle_query_db({
            'db_path': params['meta_path'],
            'query': f"SELECT e FROM a WHERE h = '{params['bundle_hash']}'",
            'key': params.get('meta_key')
        })

        bundle_key_str = query_result['rows'][0][0] if query_result['rows'] else None
        bundle_key = int(bundle_key_str) if bundle_key_str and bundle_key_str != 'None' else 0

        if bundle_key != 0:
            with open(asset_path, 'rb') as f:
                data = f.read()
            if len(data) > 256:
                final_key = _create_final_key(bundle_key)
                decrypted_data = bytearray(data)
                key_len = len(final_key)
                for i in range(256, len(decrypted_data)):
                    decrypted_data[i] ^= final_key[i % key_len]
                return UnityPy.load(bytes(decrypted_data))
            else:
                return UnityPy.load(data)
    return UnityPy.load(asset_path)

def handle_extract_race_story_data(params):
    env = _load_env_from_path(params['asset_path'], params)
    asset_bundle = None
    for obj in env.objects:
        if obj.type.name == "AssetBundle":
            asset_bundle = obj.read()
            break
    if not asset_bundle:
        raise ValueError("Failed to find AssetBundle object")

    container = asset_bundle.m_Container
    asset_name_in_bundle = f"assets/_gallopresources/bundle/resources/race/storyrace/text/{params['asset_name']}.asset"
    if asset_name_in_bundle not in container:
        raise ValueError("Failed to find text asset in bundle")

    text_asset_ptr = container[asset_name_in_bundle].asset
    text_asset = text_asset_ptr.read()

    texts = [item.text for item in text_asset.textData]
    return {"texts": texts}

def handle_extract_lyrics_data(params):
    env = _load_env_from_path(params['asset_path'], params)
    lyrics_asset_name = params['asset_name']

    for obj in env.objects:
        if obj.type.name == "TextAsset":
            asset = obj.read()
            if asset.name == lyrics_asset_name:
                return {"csv_data": bytes(asset.script).decode('utf-8')}

    raise ValueError(f"Failed to find lyrics asset '{lyrics_asset_name}' in bundle")

def handle_version(params):
    return {"unitypy_version": UnityPy.__version__}

def handle_check_apsw(params):
    try:
        import apsw
        return {"apsw_installed": True, "version": apsw.apswversion()}
    except ImportError:
        return {"apsw_installed": False}

def handle_query_db(params):
    import apsw
    db_path = params.get('db_path')
    if not db_path:
        raise ValueError("'db_path' parameter is missing")
    query = params.get('query')
    key = params.get('key')

    if not key:
        raise ValueError("'key' parameter is missing for query_db")

    db_uri = Path(db_path).as_uri()
    conn_str = f"{db_uri}?mode=ro&hexkey={key}"
    db = apsw.Connection(conn_str, flags=apsw.SQLITE_OPEN_URI | apsw.SQLITE_OPEN_READONLY)

    cursor = db.cursor()
    header = []
    results = []

    with db:
        cursor.execute(query)

        try:
            header = [desc[0] for desc in cursor.getdescription()]
        except apsw.ExecutionCompleteError:
            pass

        results = list(cursor)

    db.close()
    rows = [[str(item) for item in row] for row in results]
    return {"header": header, "rows": rows}

def handle_extract_story_data(params):
    env = _load_env_from_path(params['asset_path'], params)

    asset_bundle = None
    for obj in env.objects:
        if obj.type.name == "AssetBundle":
            asset_bundle = obj.read()
            break
    if not asset_bundle:
        raise ValueError("Failed to find AssetBundle object")

    container = asset_bundle.m_Container
    if not container:
        raise ValueError("AssetBundle is missing its 'm_Container' property")

    asset_name = params['asset_name']
    if asset_name not in container:
        raise ValueError(f"Failed to find timeline data asset '{asset_name}' in AssetBundle container")

    timeline_data_ptr = container[asset_name].asset

    timeline_data = timeline_data_ptr.read().type_tree

    title = timeline_data.Title

    block_list_data = []
    raw_block_list = timeline_data.BlockList
    for block in raw_block_list[1:]:
        text_clip_ptr = block.TextTrack.ClipList[0]
        if not text_clip_ptr: continue

        text_clip = text_clip_ptr.read()

        choices = []
        for choice in text_clip.ChoiceDataList:
            choices.append({
                "text": choice.Text,
                "nextBlock": choice.NextBlock,
                "differenceFlag": choice.DifferenceFlag
            })

        color_texts = []
        for color_text in text_clip.ColorTextInfoList:
            color_texts.append({ "text": color_text.Text })

        block_list_data.append({
            "name": text_clip.Name,
            "text": text_clip.Text,
            "nextBlock": text_clip.NextBlock,
            "differenceFlag": text_clip.DifferenceFlag,
            "cueId": text_clip.CueId,
            "choices": choices,
            "colorTexts": color_texts
        })

    return {"title": title, "blockList": block_list_data}

def main():
    try:
        command = sys.argv[1]
        params_json = sys.argv[2]
        params = json.loads(params_json)

        handlers = {
            "version": handle_version,
            "check_apsw": handle_check_apsw,
            "query_db": handle_query_db,
            "extract_story_data": handle_extract_story_data,
            "extract_race_story_data": handle_extract_race_story_data,
            "extract_lyrics_data": handle_extract_lyrics_data,
        }

        if command in handlers:
            result = handlers[command](params)
            response = {"status": "success", "data": result}
        else:
            raise ValueError(f"Unknown command: {command}")

    except Exception as e:
        import traceback
        response = {"status": "error", "message": f"{str(e)}\n{traceback.format_exc()}"}

    print(json.dumps(response))

if __name__ == "__main__":
    main()
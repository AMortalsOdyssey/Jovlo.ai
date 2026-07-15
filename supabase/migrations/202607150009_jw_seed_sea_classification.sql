-- Reclassify imported AI Studio seed destinations by meaning instead of array order.
-- User-created wishes are intentionally untouched.

begin;
update public.jw_wishes
set sea = case
  when destination ~* '(雪|冰|极光|冰川|温泉|冬|北海道|阿尔山|哈尔滨|阿勒泰|喀纳斯|iceland|finland|norway|lapland|antarctica)'
    then 'snow'
  when destination ~* '(岛|海岸|海滩|沙滩|潜水|珊瑚|冲绳|巴厘|马尔代夫|塞班|普吉|三亚|青岛|厦门|鼓浪屿|大连|涠洲|台湾|海南|sri lanka|maldives|bali|hawaii)'
    then 'island'
  when destination ~* '(山|峰|徒步|峡谷|高原|草原|沙漠|森林|国家公园|张家界|九寨|黄山|华山|泰山|稻城|西藏|新疆|hiking|mountain|canyon|plateau|national park)'
    then 'ridge'
  when destination ~* '(故乡|老家|童年|重返|再去|回到|旧梦)'
    then 'olddream'
  when destination ~* '(古城|故宫|博物馆|夜市|市集|小镇|老街|街巷|寺|庙|园林|迪士尼|烟花|庆典|美食|北京|上海|杭州|苏州|南京|西安|成都|重庆|长沙|武汉|广州|深圳|香港|澳门|洛阳|开封|敦煌|丽江|大理)'
    then 'fireworks'
  when destination ~* '(南极|北极|世界尽头|间隔年|此生|非洲|南美|北美|欧洲|大洋洲|faraway|arctic)'
    or not is_china
    then 'faraway'
  else 'gonow'
end,
updated_at = now()
where is_seed;
commit;

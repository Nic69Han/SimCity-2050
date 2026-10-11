// Reference implementation copied from Micropolis::simRandom / getRandom* (random.cpp)
#include <cstdio>
#include <algorithm>
typedef unsigned long UQuad;
static UQuad nextRandom;
int simRandom(){ nextRandom = nextRandom * 1103515245 + 12345; return (nextRandom & 0xffff00) >> 8; }
int getRandom16(){ return simRandom() & 0xffff; }
int getRandom16Signed(){ int i=getRandom16(); if(i>0x7fff) i=0x7fff-i; return i; }
short getRandom(short range){ int maxMultiple,rnum; range++; maxMultiple=0xffff/range; maxMultiple*=range; do{rnum=getRandom16();}while(rnum>=maxMultiple); return rnum%range; }
short getERandom(short limit){ short z=getRandom(limit); short x=getRandom(limit); return std::min(z,x); }
int main(){
  int seeds[]={0,1,42,-1,123456789};
  for(int s: seeds){
    nextRandom=s; printf("SIM %d:",s); for(int i=0;i<6;i++) printf(" %d",simRandom()); printf("\n");
    nextRandom=s; printf("R16 %d:",s); for(int i=0;i<6;i++) printf(" %d",getRandom16()); printf("\n");
    nextRandom=s; printf("R16S %d:",s); for(int i=0;i<6;i++) printf(" %d",getRandom16Signed()); printf("\n");
    nextRandom=s; printf("R10 %d:",s); for(int i=0;i<6;i++) printf(" %d",getRandom(10)); printf("\n");
    nextRandom=s; printf("E50 %d:",s); for(int i=0;i<6;i++) printf(" %d",getERandom(50)); printf("\n");
  }
}
